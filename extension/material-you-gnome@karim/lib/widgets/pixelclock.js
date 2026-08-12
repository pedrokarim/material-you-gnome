/* Horloge « pixel » — troisième variante de cadran.
 *
 * Reprend widgets/clock/PixelClock.qml : les quatre chiffres de l'heure disposés
 * en carré, H0 H1 sur la première ligne, M0 M1 sur la seconde. Chez eux chaque
 * glyphe est redessiné avec de légers décalages pour obtenir un contour ; St
 * n'a pas d'équivalent au texte contourné, donc l'effet passe ici par le
 * contraste entre heures et minutes.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Comme la variante numérique : l'affichage ne montre pas les secondes, une
// demi-minute suffit à ne jamais dériver visiblement.
const REFRESH_SECONDS = 30;

export const PixelClock = GObject.registerClass(
class PixelClock extends St.Widget {
    _init() {
        super._init({
            layout_manager: new Clutter.GridLayout(),
            style_class: 'myg-pixel',
            reactive: false,
        });

        const layout = this.layout_manager;
        this._digits = [];

        // Deux lignes de deux : les heures en haut, les minutes en bas.
        for (let i = 0; i < 4; i++) {
            const label = new St.Label({
                style_class: i < 2 ? 'myg-pixel-digit hours' : 'myg-pixel-digit minutes',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._digits.push(label);
            layout.attach(label, i % 2, Math.floor(i / 2), 1, 1);
        }

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
        // %H et %M sont déjà sur deux chiffres : un simple découpage suffit.
        const text = now.format('%H%M');
        this._digits.forEach((label, i) => {
            label.text = text[i];
        });
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
