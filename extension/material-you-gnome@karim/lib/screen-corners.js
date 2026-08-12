/* Coins d'écran arrondis.
 *
 * Reprend modules/ii/screenCorners/ : quatre masques posés aux angles de
 * l'écran, qui donnent l'illusion d'une dalle aux bords arrondis.
 *
 * Chaque coin est le complément d'un quart de disque — on remplit le carré puis
 * on en retire le disque, plutôt que de dessiner l'arc directement : c'est la
 * seule façon d'obtenir la forme concave.
 *
 * Ils vivent dans la couche « chrome » de GNOME, avec `trackFullscreen` : une
 * vidéo en plein écran doit occuper la dalle entière, coins compris.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Cairo from 'gi://cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CORNERS = [
    ['top-left', 0, 0],
    ['top-right', 1, 0],
    ['bottom-left', 0, 1],
    ['bottom-right', 1, 1],
];

const Corner = GObject.registerClass(
class Corner extends St.DrawingArea {
    _init(right, bottom, radius) {
        super._init({
            style_class: 'myg-screen-corner',
            width: radius,
            height: radius,
            reactive: false,
        });

        this._right = right;
        this._bottom = bottom;

        this.connect('style-changed', () => this.queue_repaint());
        this.connect('repaint', () => this._draw());
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();

        // La couleur vient du nœud de thème : un coin doit s'accorder au bord de
        // la barre quand il la touche.
        const node = this.get_theme_node();
        const [found, color] = node.lookup_color('-myg-corner-color', false);
        const c = found ? color : node.get_background_color();
        cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255);

        // Centre du disque : l'angle opposé à celui de l'écran.
        const cx = this._right ? 0 : w;
        const cy = this._bottom ? 0 : h;

        cr.rectangle(0, 0, w, h);
        cr.newSubPath();
        cr.arc(cx, cy, w, 0, 2 * Math.PI);
        // EVEN_ODD : le disque perce le rectangle au lieu de s'y ajouter.
        cr.setFillRule(Cairo.FillRule.EVEN_ODD);
        cr.fill();

        cr.$dispose();
    }
});

export class ScreenCorners {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._corners = [];
        this._signals = [];
        this._settingsIds = [];
    }

    enable() {
        for (const key of ['screen-corners', 'screen-corner-radius']) {
            this._settingsIds.push(
                this._settings.connect(`changed::${key}`, () => this._sync()));
        }

        this._signals.push([
            Main.layoutManager,
            Main.layoutManager.connect('monitors-changed', () => this._sync()),
        ]);

        this._sync();
    }

    _sync() {
        this._clear();
        if (!this._settings.get_boolean('screen-corners'))
            return;

        const radius = this._settings.get_int('screen-corner-radius');
        const monitors = Main.layoutManager.monitors ?? [];

        // Tous les écrans, pas seulement le principal : n'arrondir qu'un seul
        // écran d'un ensemble se verrait immédiatement.
        for (const monitor of monitors) {
            for (const [, right, bottom] of CORNERS) {
                if (this._touchesNeighbour(monitor, monitors, right))
                    continue;

                const corner = new Corner(right, bottom, radius);
                corner.set_position(
                    monitor.x + (right ? monitor.width - radius : 0),
                    monitor.y + (bottom ? monitor.height - radius : 0));

                Main.layoutManager.addChrome(corner, {trackFullscreen: true});
                this._corners.push(corner);
            }
        }
    }

    /* Un bord collé à un autre écran ne doit pas être arrondi : ça creuserait
     * une encoche noire au milieu du bureau au lieu de suivre la dalle. */
    _touchesNeighbour(monitor, monitors, right) {
        const edge = right ? monitor.x + monitor.width : monitor.x;

        return monitors.some(other => {
            if (other === monitor)
                return false;

            const adjacent = right
                ? other.x === edge
                : other.x + other.width === edge;

            // Adjacence horizontale seulement si les écrans se recouvrent aussi
            // verticalement — deux écrans empilés ne se touchent pas ici.
            const overlaps = other.y < monitor.y + monitor.height
                && monitor.y < other.y + other.height;

            return adjacent && overlaps;
        });
    }

    _clear() {
        for (const corner of this._corners) {
            Main.layoutManager.removeChrome(corner);
            corner.destroy();
        }
        this._corners = [];
    }

    disable() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        this._clear();
    }
}
