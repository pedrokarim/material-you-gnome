/* Indicateur média du top bar.
 *
 * Équivalent de modules/ii/bar/Media.qml. Toute la mécanique D-Bus vit dans
 * lib/mpris.js, partagée avec la carte bureau : ici il ne reste que
 * l'affichage.
 *
 * Volontairement minimal : titre • artiste, clic = play/pause, molette =
 * piste précédente / suivante, et l'indicateur disparaît quand aucun lecteur
 * n'expose de piste.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {getWatcher} from './mpris.js';

const MAX_CHARS = 40;

const MediaButton = GObject.registerClass(
class MediaButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Media', true);

        this.add_style_class_name('myg-media');

        this._icon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'myg-media-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: 'myg-media-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const box = new St.BoxLayout({style_class: 'myg-media-box'});
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        // Caché tant qu'aucune piste n'est connue : la découverte est
        // asynchrone, et une pilule vide qui clignote au démarrage se voit.
        this.visible = false;

        this._watcher = getWatcher();
        this._changedId = this._watcher.connect('changed', () => this._sync());

        this.connect('button-press-event', () => {
            this._watcher.playPause();
            return Clutter.EVENT_STOP;
        });
        this.connect('scroll-event', (_a, event) => this._onScroll(event));
        this.connect('destroy', () => this._onDestroy());

        this._sync();
    }

    _sync() {
        const track = this._watcher.track;
        if (!track) {
            this.visible = false;
            return;
        }

        this._icon.icon_name = track.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        let text = track.artist ? `${track.title} • ${track.artist}` : track.title;
        if (text.length > MAX_CHARS)
            text = `${text.slice(0, MAX_CHARS - 1)}…`;

        this._label.text = text;
        this.visible = true;
    }

    _onScroll(event) {
        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.UP) {
            this._watcher.previous();
            return Clutter.EVENT_STOP;
        }
        if (dir === Clutter.ScrollDirection.DOWN) {
            this._watcher.next();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onDestroy() {
        // On débranche seulement : le watcher est partagé, sa destruction est
        // du ressort d'extension.js.
        if (this._changedId) {
            this._watcher.disconnect(this._changedId);
            this._changedId = 0;
        }
    }
});

export class MediaIndicator {
    constructor(extension) {
        this._extension = extension;
        this._button = null;
    }

    enable() {
        this._button = new MediaButton();
        Main.panel.addToStatusArea('myg-media', this._button, 2, 'left');
    }

    disable() {
        this._button?.destroy();
        this._button = null;
    }
}
