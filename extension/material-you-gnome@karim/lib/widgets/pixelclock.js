/* Horloge « chiffres en carré » — troisième variante de cadran.
 *
 * Reprend widgets/clock/PixelClock.qml : les quatre chiffres de l'heure disposés
 * en carré, H0 H1 sur la première ligne, M0 M1 sur la seconde.
 *
 * Dessinée en Cairo, comme le cadran festonné, et pour la même raison qu'on
 * finit toujours par y venir : une étiquette St occupe la boîte de ligne de sa
 * police — ascendante et descendante comprises — pas la hauteur des chiffres.
 * À cette taille ça laisse une bande vide entre les deux rangées, que ni
 * `spacing-rows: 0` ni un rognage de l'étiquette ne règlent : rogner la boîte
 * ne rogne pas le glyphe, qui déborde alors sur le widget suivant.
 *
 * En Cairo on mesure le chiffre (`textExtents`) et on le pose exactement où on
 * veut. Le vide disparaît, et la hauteur annoncée correspond à ce qui est peint.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Cairo from 'gi://cairo';

const FONT_SIZE = 104;

// Zone calée sur les chiffres eux-mêmes : à cette taille ils font ~58 px de
// large et ~75 px de haut, on laisse donc juste de quoi les séparer.
const WIDTH = 185;
const HEIGHT = 180;

// Les deux colonnes et les deux lignes, en fraction de la zone de dessin.
const COLUMNS = [0.30, 0.70];
const ROWS = [0.27, 0.73];

// L'affichage ne montre pas les secondes : une demi-minute suffit à ne jamais
// dériver visiblement.
const REFRESH_SECONDS = 30;

function useColor(cr, color) {
    cr.setSourceRGBA(
        color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
}

export const PixelClock = GObject.registerClass(
class PixelClock extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'myg-pixel',
            width: WIDTH,
            height: HEIGHT,
            reactive: false,
        });

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('style-changed', () => this.queue_repaint());
        this.connect('repaint', () => this._draw());
        this.connect('destroy', () => this._onDestroy());
    }

    get anchor() {
        return 'top-left';
    }

    _color(name) {
        const node = this.get_theme_node();
        const [found, color] = node.lookup_color(name, false);
        return found ? color : node.get_foreground_color();
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();

        // %H et %M sont déjà sur deux chiffres : un découpage suffit.
        const digits = GLib.DateTime.new_now_local().format('%H%M');

        const hours = this._color('-myg-pixel-hours');
        const minutes = this._color('-myg-pixel-minutes');

        cr.selectFontFace('Readex Pro', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(FONT_SIZE);

        digits.split('').forEach((digit, i) => {
            useColor(cr, i < 2 ? hours : minutes);

            // On centre sur l'encre du glyphe, pas sur son avance : c'est ce qui
            // aligne visuellement des chiffres de largeurs différentes.
            const ext = cr.textExtents(digit);
            const x = w * COLUMNS[i % 2] - (ext.width / 2 + ext.xBearing);
            const y = h * ROWS[Math.floor(i / 2)] - (ext.height / 2 + ext.yBearing);

            cr.moveTo(x, y);
            cr.showText(digit);
        });

        cr.newPath();   // showText laisse la position courante dans le chemin
        cr.$dispose();
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
