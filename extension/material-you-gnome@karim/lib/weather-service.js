/* Relevé météo, partagé par la carte météo et la carte utilisateur.
 *
 * Même motif que lib/mpris.js : deux surfaces ont besoin de la donnée, une
 * seule requête la produit. Sans ça la carte utilisateur déclencherait son
 * propre appel HTTP toutes les quinze minutes pour afficher une phrase.
 *
 * Source : Open-Meteo — pas de clé d'API, pas de compte, pas de traceur.
 * GWeather est présent sur la machine mais GNOME n'a aucun lieu configuré
 * (`org.gnome.shell.weather locations` vide, géolocalisation désactivée).
 *
 * Le lieu vient de ~/.config/material-you-gnome/weather.conf, écrit par
 * `bin/set-weather`. Tant qu'il n'existe pas, AUCUNE requête n'est émise :
 * déduire la position depuis l'IP exposerait l'utilisateur à un service tiers
 * sans qu'il l'ait demandé.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const REFRESH_SECONDS = 900;   // 15 min : la météo ne bouge pas plus vite

const CONF = GLib.build_filenamev(
    [GLib.get_user_config_dir(), 'material-you-gnome', 'weather.conf']);

/* Codes WMO → icône symbolique Adwaita + libellé. Open-Meteo ne renvoie qu'un
 * code numérique ; la table est la traduction officielle WMO 4677 condensée. */
export const CONDITIONS = {
    0: ['weather-clear-symbolic', 'ciel dégagé'],
    1: ['weather-few-clouds-symbolic', 'peu nuageux'],
    2: ['weather-few-clouds-symbolic', 'partiellement nuageux'],
    3: ['weather-overcast-symbolic', 'couvert'],
    45: ['weather-fog-symbolic', 'brouillard'],
    48: ['weather-fog-symbolic', 'brouillard givrant'],
    51: ['weather-showers-scattered-symbolic', 'bruine légère'],
    53: ['weather-showers-scattered-symbolic', 'bruine'],
    55: ['weather-showers-scattered-symbolic', 'bruine dense'],
    56: ['weather-showers-scattered-symbolic', 'bruine verglaçante'],
    57: ['weather-showers-scattered-symbolic', 'bruine verglaçante dense'],
    61: ['weather-showers-symbolic', 'pluie faible'],
    63: ['weather-showers-symbolic', 'pluie'],
    65: ['weather-showers-symbolic', 'pluie forte'],
    66: ['weather-showers-symbolic', 'pluie verglaçante'],
    67: ['weather-showers-symbolic', 'pluie verglaçante forte'],
    71: ['weather-snow-symbolic', 'neige faible'],
    73: ['weather-snow-symbolic', 'neige'],
    75: ['weather-snow-symbolic', 'neige forte'],
    77: ['weather-snow-symbolic', 'grains de neige'],
    80: ['weather-showers-symbolic', 'averses faibles'],
    81: ['weather-showers-symbolic', 'averses'],
    82: ['weather-showers-symbolic', 'averses violentes'],
    85: ['weather-snow-symbolic', 'averses de neige'],
    86: ['weather-snow-symbolic', 'fortes averses de neige'],
    95: ['weather-storm-symbolic', 'orage'],
    96: ['weather-storm-symbolic', 'orage et grêle'],
    99: ['weather-storm-symbolic', 'orage violent et grêle'],
};

/* Phrase d'ambiance de la carte utilisateur, reprise de UserCardWidget.qml.
 * Regroupée par famille de code WMO plutôt que par description textuelle : le
 * code est stable, le libellé est de la présentation. */
export function quipFor(code) {
    if (code === undefined || code === null)
        return null;
    if (code === 0 || code === 1)
        return 'bonne journée pour sortir';
    if (code === 2 || code === 3)
        return 'un peu nuageux aujourd\'hui';
    if (code >= 71 && code <= 77 || code === 85 || code === 86)
        return 'il neige';
    if (code >= 95)
        return 'orage, reste au chaud';
    if (code >= 51 && code <= 82)
        return 'il pleut, prends un café';
    if (code === 45 || code === 48)
        return 'brouillard, roule doucement';
    return CONDITIONS[code]?.[1] ?? null;
}

export const WeatherService = GObject.registerClass({
    Signals: {'changed': {}},
}, class WeatherService extends GObject.Object {
    _init() {
        super._init();

        this._data = null;       // null tant qu'aucun relevé n'a abouti
        this._configured = true; // faux si le fichier de lieu manque

        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });

        this.refresh();
    }

    /* { temperature, humidity, wind, code, place } ou null. */
    get data() {
        return this._data;
    }

    get configured() {
        return this._configured;
    }

    refresh() {
        const loc = this._location();
        if (!loc) {
            this._configured = false;
            this._data = null;
            this.emit('changed');
            return;
        }
        this._configured = true;

        const url = 'https://api.open-meteo.com/v1/forecast'
            + `?latitude=${loc.lat}&longitude=${loc.lon}`
            + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code'
            + '&timezone=auto';

        const message = Soup.Message.new('GET', url);

        this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
                let json;
                try {
                    const bytes = session.send_and_read_finish(res);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                } catch (e) {
                    // Hors ligne ou API en rade : on garde le dernier relevé
                    // plutôt que de vider les cartes.
                    return;
                }

                const cur = json?.current;
                if (!cur)
                    return;

                this._data = {
                    temperature: cur.temperature_2m,
                    humidity: cur.relative_humidity_2m,
                    wind: cur.wind_speed_10m,
                    code: cur.weather_code,
                    place: loc.label,
                };
                this.emit('changed');
            });
    }

    /* Format volontairement trivial (clé = valeur), pour rester éditable à la
     * main sans fenêtre de préférences. */
    _location() {
        let text;
        try {
            const [ok, bytes] = GLib.file_get_contents(CONF);
            if (!ok)
                return null;
            text = new TextDecoder().decode(bytes);
        } catch (e) {
            return null;
        }

        const grab = key => {
            const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm'));
            return m ? m[1] : null;
        };

        const lat = Number(grab('latitude'));
        const lon = Number(grab('longitude'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return null;

        return {lat, lon, label: grab('label') ?? ''};
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});

let service = null;

export function getWeather() {
    if (!service)
        service = new WeatherService();
    return service;
}

export function releaseWeather() {
    service?.destroy();
    service = null;
}
