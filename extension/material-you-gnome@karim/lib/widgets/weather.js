/* Carte météo du bureau.
 *
 * Reprend widgets/weather/WeatherWidget.qml : température en gros, description,
 * lieu et mesures secondaires.
 *
 * Toute la collecte vit dans lib/weather-service.js, partagée avec la carte
 * utilisateur ; ici il ne reste que l'affichage.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {getWeather, CONDITIONS} from '../weather-service.js';

export const Weather = GObject.registerClass(
class Weather extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'myg-card myg-weather',
            reactive: false,
        });

        const left = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._temp = new St.Label({text: '—', style_class: 'myg-weather-temp'});
        this._desc = new St.Label({text: '', style_class: 'myg-weather-desc'});
        this._place = new St.Label({text: '', style_class: 'myg-weather-place'});
        left.add_child(this._temp);
        left.add_child(this._desc);
        left.add_child(this._place);

        this.add_child(left);
        this.add_child(new St.Widget({x_expand: true}));

        this._icon = new St.Icon({
            icon_name: 'weather-clear-symbolic',
            style_class: 'myg-weather-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        this._service = getWeather();
        this._changedId = this._service.connect('changed', () => this._sync());

        this.connect('destroy', () => this._onDestroy());
        this._sync();
    }

    get anchor() {
        return 'top-right';
    }

    _sync() {
        if (!this._service.configured) {
            this._temp.text = '—';
            this._desc.text = 'lieu non configuré';
            this._place.text = 'bin/set-weather <ville>';
            return;
        }

        const data = this._service.data;
        if (!data) {
            if (this._temp.text === '—')
                this._desc.text = 'météo indisponible';
            return;
        }

        const [iconName, label] =
            CONDITIONS[data.code] ?? ['weather-severe-alert-symbolic', '—'];

        this._temp.text = `${Math.round(data.temperature)}°C`;
        this._desc.text = label;
        this._place.text = [
            data.place,
            data.humidity !== undefined ? `${data.humidity} %` : null,
            data.wind !== undefined ? `${Math.round(data.wind)} km/h` : null,
        ].filter(Boolean).join(' · ');
        this._icon.icon_name = iconName;
    }

    _onDestroy() {
        // Débranchement seulement : le service est partagé, sa destruction
        // appartient à extension.js.
        if (this._changedId) {
            this._service.disconnect(this._changedId);
            this._changedId = 0;
        }
    }
});
