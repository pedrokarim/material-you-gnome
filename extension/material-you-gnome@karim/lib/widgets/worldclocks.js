/* Horloges mondiales.
 *
 * Reprend widgets/worldclock/WorldClockWidget.qml : l'heure locale en grand,
 * la date en toutes lettres, puis une grille de fuseaux avec leur décalage.
 *
 * Les fuseaux viennent de la clé `world-clocks`, au format « Libellé|Zone IANA ».
 * On n'utilise pas `org.gnome.shell.world-clocks` : cette clé stocke des
 * localisations GWeather sérialisées, illisibles sans GWeather et pénibles à
 * écrire depuis un panneau de préférences.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const COLUMNS = 2;
const REFRESH_SECONDS = 20;

export const WorldClocks = GObject.registerClass(
class WorldClocks extends St.BoxLayout {
    _init(extension) {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-worldclocks',
            reactive: false,
        });

        this._settings = extension.getSettings();

        this._time = new St.Label({style_class: 'myg-wc-time'});
        this._date = new St.Label({style_class: 'myg-wc-date'});
        this.add_child(this._time);
        this.add_child(this._date);

        // La grille doit occuper toute la largeur de la carte : sans expansion
        // elle se tasse à gauche et laisse un vide franc à droite.
        this._grid = new St.Widget({
            layout_manager: new Clutter.GridLayout(),
            style_class: 'myg-wc-grid',
            x_expand: true,
        });
        this.add_child(this._grid);

        this._settingsId = this._settings.connect(
            'changed::world-clocks', () => this._rebuild());

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._sync();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._rebuild();
    }

    // Ancrée à droite : la colonne gauche (horloge + citation + média +
    // calendrier) dépasse déjà la hauteur d'un écran 1080 p.
    get anchor() {
        return 'top-right';
    }

    /* Une entrée mal formée ne doit pas faire tomber le widget entier : on la
     * saute et on garde les autres. */
    _zones() {
        const zones = [];
        for (const entry of this._settings.get_strv('world-clocks')) {
            const sep = entry.indexOf('|');
            if (sep <= 0)
                continue;

            const id = entry.slice(sep + 1).trim();
            const tz = GLib.TimeZone.new_identifier(id);
            if (!tz)
                continue;   // fuseau inconnu de la base système

            zones.push({label: entry.slice(0, sep).trim(), tz});
        }
        return zones;
    }

    _rebuild() {
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;

        this._cells = this._zones().map((zone, i) => {
            const cell = new St.BoxLayout({
                vertical: true,
                style_class: 'myg-wc-cell',
                x_expand: true,   // les colonnes se partagent la largeur
            });

            const head = new St.BoxLayout({style_class: 'myg-wc-head'});
            head.add_child(new St.Label({
                text: zone.label,
                style_class: 'myg-wc-name',
            }));
            head.add_child(new St.Widget({x_expand: true}));
            const offset = new St.Label({style_class: 'myg-wc-offset'});
            head.add_child(offset);

            const value = new St.Label({style_class: 'myg-wc-value'});
            cell.add_child(head);
            cell.add_child(value);

            layout.attach(cell, i % COLUMNS, Math.floor(i / COLUMNS), 1, 1);
            return {zone, offset, value};
        });

        this._sync();
    }

    _sync() {
        const now = GLib.DateTime.new_now_local();
        this._time.text = now.format('%H:%M');
        this._date.text = now.format('%A %-d %B %Y');

        for (const {zone, offset, value} of this._cells ?? []) {
            const there = GLib.DateTime.new_now(zone.tz);
            value.text = there.format('%H:%M');

            // %z donne « +0900 » : on le rend lisible en « UTC+9 », en gardant
            // les minutes seulement quand le décalage n'est pas rond (Inde,
            // Népal, Australie centrale…).
            const raw = there.format('%z');
            const sign = raw[0];
            const hours = parseInt(raw.slice(1, 3), 10);
            const minutes = parseInt(raw.slice(3, 5), 10);
            offset.text = minutes
                ? `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`
                : `UTC${sign}${hours}`;
        }
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
    }
});
