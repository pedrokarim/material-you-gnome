/* Couche de widgets bureau.
 *
 * Équivalent de modules/ii/background/ chez illogical-impulse : des cartes
 * posées sur le fond d'écran, sous les fenêtres. GNOME n'a rien de tel, donc
 * c'est purement additif — aucun monkey-patching, et rien à recâbler quand
 * GNOME change ses propres surfaces.
 *
 * Placement : un conteneur inséré dans global.window_group JUSTE AU-DESSUS du
 * background group. On n'ajoute pas les widgets DANS le background group :
 * GNOME y fait destroy_all_children() quand il reconstruit les fonds, donc ils
 * disparaîtraient à chaque `wallset`.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CookieClock} from './widgets/cookieclock.js';
import {DigitalClock} from './widgets/digitalclock.js';
import {PixelClock} from './widgets/pixelclock.js';
import {QuoteBubble} from './widgets/quote.js';
import {WorldClocks} from './widgets/worldclocks.js';
import {MediaCard} from './widgets/media.js';
import {CalendarCard} from './widgets/calendar.js';
import {Weather} from './widgets/weather.js';
import {Resources} from './widgets/resources.js';
import {UserCard} from './widgets/usercard.js';
import {Devices} from './widgets/devices.js';
import {AniList} from './widgets/anilist.js';

// L'ordre fait la pile : chaque ancre empile ses widgets de haut en bas.
// Chaque entrée porte la clé GSettings qui décide de sa présence.
const WIDGETS = [
    ['show-clock', null],              // colonne gauche — classe choisie plus bas
    ['show-quote', QuoteBubble],
    ['show-media', MediaCard],
    ['show-calendar', CalendarCard],
    ['show-weather', Weather],         // colonne droite
    ['show-resources', Resources],
    ['show-devices', Devices],
    ['show-anilist', AniList],
    ['show-worldclocks', WorldClocks],
    ['show-usercard', UserCard],
];

// L'horloge a deux variantes exclusives ; seule la sélectionnée est instanciée.
const CLOCKS = {cookie: CookieClock, digital: DigitalClock, pixel: PixelClock};

const GAP = 16;      // écart entre deux widgets d'une même ancre

export class Desktop {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._layer = null;
        this._widgets = [];
        this._signals = [];
        this._settingsIds = [];
    }

    enable() {
        this._layer = new St.Widget({
            name: 'myg-desktop',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,          // les clics traversent jusqu'au bureau
            style_class: 'myg-desktop',
        });

        global.window_group.add_child(this._layer);
        this._lower();

        this._build();

        // Un changement de visibilité reconstruit la couche : les widgets sont
        // légers, et les recréer évite de maintenir un état à moitié monté.
        for (const [key] of WIDGETS) {
            this._settingsIds.push(
                this._settings.connect(`changed::${key}`, () => this._rebuild()));
        }
        this._settingsIds.push(
            this._settings.connect('changed::desktop-margin', () => this._sync()));
        this._settingsIds.push(
            this._settings.connect('changed::clock-style', () => this._rebuild()));

        this._signals.push([
            Main.layoutManager,
            Main.layoutManager.connect('monitors-changed', () => this._sync()),
        ]);

        // Mutter réordonne les acteurs de window_group à chaque changement de
        // pile de fenêtres, et fait remonter au-dessus tout acteur qui n'est
        // pas une fenêtre — le nôtre repasserait donc par-dessus tout dès le
        // premier clic. Il faut donc réaffirmer la position à chaque
        // réempilement, pas seulement à l'activation.
        this._signals.push([
            global.display,
            global.display.connect('restacked', () => this._lower()),
        ]);

        this._sync();
    }

    /* Les widgets sont légers : les recréer coûte moins cher que de maintenir
     * un état à moitié monté quand un réglage change. */
    _rebuild() {
        for (const widget of this._widgets)
            widget.destroy();
        this._widgets = [];

        this._build();
        this._sync();
    }

    _build() {
        for (const [key, Widget] of WIDGETS) {
            if (!this._settings.get_boolean(key))
                continue;

            const Klass = Widget
                ?? CLOCKS[this._settings.get_string('clock-style')]
                ?? CookieClock;

            try {
                const widget = new Klass(this._extension);
                this._layer.add_child(widget);
                this._widgets.push(widget);

                // La carte média se masque quand aucun lecteur ne tourne :
                // sans ça, tout ce qui est en dessous garderait le trou.
                widget.connect('notify::visible', () => this._queueSync());

                // Les tailles issues de la feuille de style n'existent qu'une
                // fois le nœud de thème résolu, c'est-à-dire APRÈS enable().
                // Sans ce réajustement, un widget dimensionné en CSS est placé
                // d'après une taille préférée provisoire et déborde de l'écran.
                widget.connect('notify::width', () => this._queueSync());
                widget.connect('notify::height', () => this._queueSync());
            } catch (e) {
                logError(e, `material-you-gnome: widget ${Klass.name}`);
            }
        }
    }

    /* Descend la couche sous les fenêtres.
     *
     * add_child() empile en haut de window_group, donc AU-DESSUS de toutes les
     * fenêtres. Il faut redescendre — mais attention : Clutter n'émet qu'un
     * avertissement, pas d'exception, si le « sibling » passé n'est pas un
     * enfant du conteneur. Un set_child_above_sibling() sur un groupe de fond
     * qui vit ailleurs échoue donc en silence et laisse la couche par-dessus
     * tout. D'où la vérification explicite du parent.
     */
    _lower() {
        const bg = Main.layoutManager._backgroundGroup;

        if (bg && bg.get_parent() === global.window_group) {
            // Le groupe de fond est notre voisin : on se pose juste au-dessus,
            // donc sur le wallpaper mais sous les fenêtres.
            global.window_group.set_child_above_sibling(this._layer, bg);
        } else {
            // Le fond d'écran est rendu ailleurs : le bas de window_group est
            // alors la bonne place — sous toutes les fenêtres.
            global.window_group.set_child_below_sibling(this._layer, null);
        }

        this._raiseAboveDesktopWindows();
    }

    /* Les extensions d'icônes de bureau — DING sur Ubuntu — posent une fenêtre
     * de type DESKTOP qui couvre tout l'écran. Elle est au-dessus du groupe de
     * fond, donc au-dessus de nos widgets, et intercepte chaque clic : sans ce
     * relèvement, les boutons du lecteur et les flèches du calendrier ne
     * reçoivent jamais rien.
     *
     * On passe donc au-dessus d'elle, mais toujours sous les fenêtres
     * ordinaires — les widgets restent du décor de bureau, pas une surflottante.
     */
    _raiseAboveDesktopWindows() {
        let topmost = null;

        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (window?.get_window_type() !== Meta.WindowType.DESKTOP)
                continue;
            if (actor.get_parent() !== global.window_group)
                continue;
            // get_window_actors() rend les acteurs dans l'ordre d'empilement :
            // le dernier trouvé est le plus haut.
            topmost = actor;
        }

        if (topmost)
            global.window_group.set_child_above_sibling(this._layer, topmost);
    }

    /* Les notifications de taille arrivent en rafale pendant la mise en page :
     * on ne replace qu'une fois, au repos. */
    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    /* Recale la couche sur l'écran principal et empile les widgets.
     *
     * C'est la couche qui place, pas les widgets : un widget qui calculait sa
     * propre position à partir de `this.width` lisait 0, parce que Clutter
     * n'alloue qu'au prochain cycle de mise en page. Les tailles *préférées*,
     * elles, sont disponibles immédiatement.
     *
     * Chaque widget déclare seulement son ancre (`top-left` / `top-right`) ;
     * ceux qui partagent une ancre s'empilent verticalement.
     */
    _sync() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._layer)
            return;

        this._layer.set_position(monitor.x, monitor.y);
        this._layer.set_size(monitor.width, monitor.height);

        const margin = this._settings.get_int('desktop-margin');
        const nextY = {'top-left': margin, 'top-right': margin};

        for (const widget of this._widgets) {
            try {
                // Un widget masqué ne réserve pas de place dans la pile.
                if (!widget.visible)
                    continue;

                const anchor = widget.anchor ?? 'top-left';

                // La taille allouée fait foi dès qu'elle existe : elle intègre
                // le CSS, ce que la taille préférée ne fait pas tant que le
                // nœud de thème n'est pas résolu. Repli sur le préféré au tout
                // premier passage, avant toute allocation.
                const [, prefWidth] = widget.get_preferred_width(-1);
                const [, prefHeight] = widget.get_preferred_height(prefWidth);
                const width = widget.width || prefWidth;
                const height = widget.height || prefHeight;

                const x = anchor === 'top-right'
                    ? monitor.width - width - margin
                    : margin;

                widget.set_position(x, nextY[anchor]);
                nextY[anchor] += height + GAP;
            } catch (e) {
                logError(e, 'material-you-gnome: placement d\'un widget');
            }
        }
    }

    disable() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._syncId) {
            GLib.Source.remove(this._syncId);
            this._syncId = 0;
        }

        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        // destroy() du conteneur détruit les enfants, qui débranchent leurs
        // propres timers dans leur handler `destroy`.
        this._layer?.destroy();
        this._layer = null;
        this._widgets = [];
    }
}
