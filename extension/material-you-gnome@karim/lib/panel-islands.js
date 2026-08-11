/* Îlots : découpe le top bar en pilules Material 3.
 *
 * illogical-impulse compose sa barre en trois zones (gauche/centre/droite),
 * chacune contenant des « BarGroup » : des rectangles au rayon égal à la moitié
 * de leur hauteur, posés sur un fond transparent. GNOME a déjà ces trois zones
 * — _leftBox / _centerBox / _rightBox — donc on ne reconstruit rien : on leur
 * colle une classe CSS et le reste se joue dans la feuille de style générée.
 *
 * Tout est réversible : on n'ajoute que des classes, jamais de reparentage.
 * Le Panel de GNOME alloue ses trois boîtes lui-même dans vfunc_allocate ;
 * les déplacer casserait sa mise en page.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PANEL_CLASS = 'myg-panel';
const ISLAND_CLASS = 'myg-island';
const EMPTY_CLASS = 'myg-island-empty';

const BOXES = ['_leftBox', '_centerBox', '_rightBox'];

export class Islands {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._boxes = [];
        this._signals = [];
        this._settingsId = 0;
    }

    enable() {
        Main.panel.add_style_class_name(PANEL_CLASS);

        this._settingsId = this._settings.connect(
            'changed::floating-panel', () => this._syncFloating());
        this._syncFloating();

        for (const name of BOXES) {
            const box = Main.panel[name];
            if (!box)
                continue;

            box.add_style_class_name(ISLAND_CLASS);
            this._syncEmpty(box);

            // St.BoxLayout n'expose aucun signal en propre (vérifié dans
            // St-14.gir) : les `actor-added` / `actor-removed` des vieux
            // tutoriels n'existent pas ici. `notify::first-child` vient de
            // Clutter.Actor et suffit — on ne distingue que vide / non vide.
            const id = box.connect('notify::first-child', () => this._syncEmpty(box));
            this._signals.push([box, id]);
            this._boxes.push(box);
        }
    }

    /* Le fond du panel vient de la feuille de style générée ; on ne peut pas la
     * réécrire à chaud (matugen la produit). Un style inline la surcharge, et
     * revenir à null rend la main au CSS. */
    _syncFloating() {
        if (this._settings.get_boolean('floating-panel'))
            Main.panel.set_style('background-color: transparent;');
        else
            Main.panel.set_style(null);
    }

    /* Une zone vide dessinerait une pilule fantôme. Le cas est réel ici :
     * l'extension LeftClock déplace l'horloge hors du centre, ce qui peut
     * laisser _centerBox sans enfant. */
    _syncEmpty(box) {
        if (box.get_first_child() === null)
            box.add_style_class_name(EMPTY_CLASS);
        else
            box.remove_style_class_name(EMPTY_CLASS);
    }

    disable() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        Main.panel.set_style(null);

        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        for (const box of this._boxes) {
            box.remove_style_class_name(ISLAND_CLASS);
            box.remove_style_class_name(EMPTY_CLASS);
        }
        this._boxes = [];

        Main.panel.remove_style_class_name(PANEL_CLASS);
    }
}
