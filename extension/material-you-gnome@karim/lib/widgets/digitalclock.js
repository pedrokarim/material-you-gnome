/* Horloge numérique — variante de widgets/clock/DigitalClock.qml.
 *
 * Heures et minutes empilées en très grand, date en dessous. Contrairement au
 * cadran festonné, aucune forme à dessiner : c'est du St pur, donc pas de Cairo
 * ni de repaint à la seconde. Une minute suffit.
 *
 * Le choix entre les deux se fait dans le panneau de réglages ; lib/desktop.js
 * n'instancie que celle qui est sélectionnée.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// On recale à la demi-minute : le pire décalage visible est alors de 30 s, sans
// réveiller le Shell chaque seconde pour un affichage qui ne montre pas les
// secondes.
const REFRESH_SECONDS = 30;

export const DigitalClock = GObject.registerClass(
class DigitalClock extends St.BoxLayout {
    _init() {
        super._init({
            vertical: true,
            style_class: 'myg-digital',
            reactive: false,
        });

        this._hours = new St.Label({
            style_class: 'myg-digital-hours',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._minutes = new St.Label({
            style_class: 'myg-digital-minutes',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._date = new St.Label({
            style_class: 'myg-digital-date',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(this._hours);
        this.add_child(this._minutes);
        this.add_child(this._date);

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._sync();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._sync();
    }

    get anchor() {
        return 'top-left';
    }

    _sync() {
        const now = GLib.DateTime.new_now_local();
        this._hours.text = now.format('%H');
        this._minutes.text = now.format('%M');
        // Abrégée, comme la référence : « Sun, 12/07 ».
        this._date.text = now.format('%a, %d/%m');
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
