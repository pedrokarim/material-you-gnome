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

// Les quatre formes de leur BarConfig : Hug, Float, Islands, M3.
const BAR_STYLES = ['hug', 'float', 'islands', 'm3'];

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
        this._styleId = this._settings.connect(
            'changed::bar-style', () => this._syncStyle());
        this._syncFloating();
        this._syncStyle();

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

    /* La forme est portée par une classe sur le panel, pas par du JS : les
     * quatre variantes ne diffèrent que par des marges et des rayons, et le
     * CSS généré sait déjà les exprimer. */
    _syncStyle() {
        for (const style of BAR_STYLES)
            Main.panel.remove_style_class_name(`myg-bar-${style}`);
        Main.panel.add_style_class_name(
            `myg-bar-${this._settings.get_string('bar-style')}`);
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
        for (const prop of ['_settingsId', '_styleId']) {
            if (this[prop]) {
                this._settings.disconnect(this[prop]);
                this[prop] = 0;
            }
        }
        Main.panel.set_style(null);
        for (const style of BAR_STYLES)
            Main.panel.remove_style_class_name(`myg-bar-${style}`);

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
