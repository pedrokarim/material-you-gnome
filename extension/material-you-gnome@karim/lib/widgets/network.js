/* Débit réseau, en carte de bureau.
 *
 * Reprend modules/ii/bar/NetworkSpeed.qml, mais posé sur le bureau plutôt que
 * dans la barre : GNOME a déjà des indicateurs de barre pour ça — celui de
 * l'extension « system-monitor » notamment — alors que rien n'affiche le débit
 * sur le fond d'écran.
 *
 * Les compteurs de /proc/net/dev sont cumulés depuis le démarrage : le débit ne
 * se lit que par différence entre deux relevés, et le premier ne peut donc rien
 * afficher.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const REFRESH_SECONDS = 2;

/* Interfaces à ignorer : la boucle locale compterait le trafic interne, et les
 * ponts Docker doublent celui des conteneurs. */
const IGNORED = /^(lo|docker|br-|veth|virbr|tun|tap)/;

/* `download` et `upload` de Material Symbols Rounded, relevés dans la cmap de
 * la police. Le thème d'icônes n'offre rien d'utilisable : ses
 * `network-receive` / `network-transmit` se ressemblent trop pour distinguer
 * les deux sens d'un coup d'œil. */
const DOWN_GLYPH = '\uE171';
const UP_GLYPH = '\uE2C6';

function humanRate(bytesPerSecond) {
    const units = ['o', 'ko', 'Mo', 'Go'];
    let value = bytesPerSecond;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }

    // Une décimale en dessous de 10, aucune au-delà : « 1,2 Mo/s » se lit mieux
    // que « 1 Mo/s », mais « 128,4 ko/s » n'apporte rien.
    const shown = value < 10 ? value.toFixed(1) : String(Math.round(value));
    return [shown, `${units[unit]}/s`];
}

/* Une moitié de la carte : glyphe, chiffre, unité. */
const Rate = GObject.registerClass(
class Rate extends St.BoxLayout {
    _init(glyph, label) {
        super._init({style_class: 'myg-net-rate', x_expand: true});

        this.add_child(new St.Label({
            text: glyph,
            style_class: 'myg-net-glyph',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const column = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._value = new St.Label({
            text: '—',
            style_class: 'myg-net-value',
        });
        column.add_child(this._value);
        column.add_child(new St.Label({
            text: label,
            style_class: 'myg-net-label',
        }));
        this.add_child(column);
    }

    set(value, unit) {
        this._value.text = `${value} ${unit}`;
    }
});

export const Network = GObject.registerClass(
class Network extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'myg-card myg-net',
            reactive: false,
        });

        this._down = new Rate(DOWN_GLYPH, 'Réception');
        this._up = new Rate(UP_GLYPH, 'Envoi');
        this.add_child(this._down);
        this.add_child(this._up);

        this._previous = null;
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._sync();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._sync();
    }

    get anchor() {
        return 'top-right';
    }

    _read() {
        let text;
        try {
            const [ok, bytes] = GLib.file_get_contents('/proc/net/dev');
            if (!ok)
                return null;
            text = new TextDecoder().decode(bytes);
        } catch (e) {
            return null;
        }

        let received = 0;
        let sent = 0;

        // Les deux premières lignes sont l'en-tête du tableau.
        for (const line of text.split('\n').slice(2)) {
            const [name, rest] = line.split(':');
            if (!rest)
                continue;
            if (IGNORED.test(name.trim()))
                continue;

            const columns = rest.trim().split(/\s+/).map(Number);
            received += columns[0] || 0;
            sent += columns[8] || 0;
        }

        return {received, sent, at: GLib.get_monotonic_time() / 1e6};
    }

    _sync() {
        const now = this._read();
        if (!now)
            return;

        const previous = this._previous;
        this._previous = now;

        // Premier relevé : rien à soustraire, la carte garde ses tirets.
        if (!previous)
            return;

        const elapsed = now.at - previous.at;
        if (elapsed <= 0)
            return;

        this._down.set(...humanRate((now.received - previous.received) / elapsed));
        this._up.set(...humanRate((now.sent - previous.sent) / elapsed));
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
