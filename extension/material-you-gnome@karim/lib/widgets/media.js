/* Carte média du bureau.
 *
 * Reprend widgets/media/MediaWidget.qml : pochette, titre, artiste et
 * transport. La mécanique D-Bus vient de lib/mpris.js, partagée avec
 * l'indicateur du top bar.
 *
 * La carte se masque entièrement quand aucun lecteur n'expose de piste — elle
 * ne doit pas laisser un cadre vide sur le bureau. lib/desktop.js replace donc
 * la pile à chaque changement, sinon le calendrier resterait décalé du trou.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {getWatcher} from '../mpris.js';
import {getLyrics} from '../lyrics-service.js';

const ART_SIZE = 72;

// Nombre de lignes de paroles affichées, la courante au milieu. Impair par
// construction : deux lignes de contexte de chaque côté, comme la référence.
const LYRIC_LINES = 5;
const LYRIC_CONTEXT = Math.floor(LYRIC_LINES / 2);

/* `subtitles_off` de Material Symbols Rounded, relevé dans la cmap de la police
 * plutôt qu'écrit en ligature : un codepoint absent donne un glyphe manquant,
 * une ligature non résolue afficherait le mot en toutes lettres. */
const NO_LYRICS_GLYPH = '\uEF72';

export const MediaCard = GObject.registerClass(
class MediaCard extends St.BoxLayout {
    _init(extension) {
        // Colonne : la ligne « pochette + infos » en haut, les paroles dessous.
        super._init({
            style_class: 'myg-card myg-media-card',
            vertical: true,
            reactive: true,
        });

        const row = new St.BoxLayout({style_class: 'myg-media-row'});

        // La pochette est un fond, pas une icône : St.Icon ne découpe pas son
        // contenu selon `border-radius`, alors que St clippe bien une
        // background-image. C'est le seul moyen d'obtenir des coins arrondis.
        this._art = new St.Widget({
            style_class: 'myg-media-art',
            width: ART_SIZE,
            height: ART_SIZE,
            layout_manager: new Clutter.BinLayout(),
        });
        this._artFallback = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 32,
        });
        this._art.add_child(this._artFallback);
        row.add_child(this._art);

        const text = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'myg-media-text',
        });
        this._title = new St.Label({style_class: 'myg-media-title'});
        this._artist = new St.Label({style_class: 'myg-media-artist'});

        // Sans ellipsage, un titre de vidéo YouTube étire la carte sur toute la
        // largeur de l'écran : la largeur est bornée en CSS, Pango coupe ici.
        for (const label of [this._title, this._artist]) {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            label.clutter_text.single_line_mode = true;
        }

        text.add_child(this._title);
        text.add_child(this._artist);

        const controls = new St.BoxLayout({style_class: 'myg-media-controls'});
        this._prev = this._button('media-skip-backward-symbolic', () => this._watcher.previous());
        this._play = this._button('media-playback-start-symbolic', () => this._watcher.playPause());
        this._next = this._button('media-skip-forward-symbolic', () => this._watcher.next());
        controls.add_child(this._prev);
        controls.add_child(this._play);
        controls.add_child(this._next);

        // Marqueur « pas de paroles » : au bout de la rangée de transport
        // plutôt que sur sa propre ligne, où il consommait toute une hauteur
        // pour une icône. Sans lui, la carte se contente de rétrécir et on ne
        // sait pas si la recherche est en cours ou si elle n'a rien donné.
        this._noLyrics = new St.Label({
            text: NO_LYRICS_GLYPH,
            style_class: 'myg-media-nolyrics',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        controls.add_child(this._noLyrics);

        text.add_child(controls);

        row.add_child(text);
        this.add_child(row);

        // Paroles : LYRIC_LINES étiquettes réutilisées, dont on ne change que
        // le texte et l'opacité. Les recréer à chaque seconde ferait clignoter
        // la mise en page.
        this._lyricsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'myg-media-lyrics',
        });
        this._lyricLabels = [];
        for (let i = 0; i < LYRIC_LINES; i++) {
            const label = new St.Label({style_class: 'myg-media-lyric'});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            label.clutter_text.single_line_mode = true;
            this._lyricLabels.push(label);
            this._lyricsBox.add_child(label);
        }
        this._lyricsBox.visible = false;
        this.add_child(this._lyricsBox);

        this.visible = false;

        // Annule un téléchargement de pochette encore en vol si le widget
        // disparaît : le callback toucherait des acteurs détruits.
        this._artCancellable = new Gio.Cancellable();

        this._watcher = getWatcher();
        this._changedId = this._watcher.connect('changed', () => this._sync());

        this._settings = extension.getSettings();
        this._settingsId = this._settings.connect(
            'changed::show-lyrics', () => this._syncLyrics());

        this._lyrics = getLyrics();
        this._lyricsId = this._lyrics.connect('changed', () => this._syncLyrics());
        // La position n'est notifiée que par le sondage du watcher, une fois
        // par seconde et seulement en lecture.
        this._positionId = this._watcher.connect('position', () => this._syncLyrics());
        this.connect('destroy', () => this._onDestroy());

        this._sync();
        this._syncLyrics();
    }

    get anchor() {
        return 'top-left';
    }

    _button(iconName, onClick) {
        const button = new St.Button({
            style_class: 'myg-media-button',
            child: new St.Icon({icon_name: iconName, icon_size: 18}),
            can_focus: true,
        });
        button.connect('clicked', onClick);
        return button;
    }

    _sync() {
        const track = this._watcher.track;
        const wasVisible = this.visible;

        if (!track) {
            this.visible = false;
            if (wasVisible)
                this.notify('visible');
            return;
        }

        this._title.text = track.title;
        this._artist.text = track.artist || '—';
        this._play.child.icon_name = track.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        this._setArt(track.artUrl);

        this.visible = true;
        if (!wasVisible)
            this.notify('visible');
    }

    /* mpris:artUrl est un file:// local (lecteurs de fichiers) ou un https://
     * distant (Spotify, navigateurs). St ne sait pas charger une URL distante
     * en background-image : on rapatrie donc l'image dans le cache avant de
     * l'afficher. Gio.File gère le téléchargement via GVfs.
     *
     * Le nom du fichier de cache dérive de l'URL, ce qui évite de retélécharger
     * la même pochette à chaque changement de propriété MPRIS (elles arrivent
     * plusieurs fois par piste). */
    _setArt(artUrl) {
        if (artUrl === this._artUrl)
            return;
        this._artUrl = artUrl;

        if (!artUrl) {
            this._showFallbackArt();
            return;
        }

        if (artUrl.startsWith('file://')) {
            this._paintArt(GLib.uri_unescape_string(artUrl.slice(7), null));
            return;
        }

        const target = GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'material-you-gnome',
            `art-${this._hash(artUrl)}`,
        ]);

        if (GLib.file_test(target, GLib.FileTest.EXISTS)) {
            this._paintArt(target);
            return;
        }

        Gio.File.new_for_uri(artUrl).load_contents_async(this._artCancellable, (file, res) => {
            let bytes;
            try {
                [, bytes] = file.load_contents_finish(res);
            } catch (e) {
                this._showFallbackArt();
                return;
            }
            try {
                GLib.mkdir_with_parents(GLib.path_get_dirname(target), 0o755);
                GLib.file_set_contents(target, bytes);
                this._paintArt(target);
            } catch (e) {
                this._showFallbackArt();
            }
        });
    }

    _paintArt(path) {
        this._artFallback.visible = false;
        // `background-size: cover` recadre sans déformer : les pochettes ne sont
        // pas toutes carrées.
        this._art.set_style(
            `background-image: url("file://${path}"); background-size: cover;`);
    }

    _showFallbackArt() {
        this._art.set_style(null);
        this._artFallback.visible = true;
    }

    /* djb2 : il ne s'agit que de nommer un fichier de cache, pas de sécurité. */
    _hash(text) {
        let h = 5381;
        for (let i = 0; i < text.length; i++)
            h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
        return h.toString(16);
    }

    /* Fenêtre glissante autour de la ligne courante. Les étiquettes hors
     * paroles restent vides plutôt que masquées : la carte garde une hauteur
     * stable, sinon elle sautille à chaque vers. */
    _syncLyrics() {
        const enabled = this._settings.get_boolean('show-lyrics');
        const lines = enabled ? this._lyrics.lines : null;

        if (!lines) {
            this._lyricsBox.visible = false;
            // Le marqueur ne s'affiche que si l'on a vraiment cherché : réglage
            // actif, piste en cours, et recherche terminée.
            this._noLyrics.visible =
                enabled && Boolean(this._watcher.track) && this._lyrics.settled;
            return;
        }

        this._noLyrics.visible = false;
        const current = this._lyrics.indexAt(this._watcher.position);
        this._lyricsBox.visible = true;

        this._lyricLabels.forEach((label, slot) => {
            const index = current - LYRIC_CONTEXT + slot;
            const line = index >= 0 && index < lines.length ? lines[index] : null;

            label.text = line ? line.text : '';
            if (slot === LYRIC_CONTEXT)
                label.add_style_class_name('current');
            else
                label.remove_style_class_name('current');
        });
    }

    _onDestroy() {
        this._artCancellable.cancel();
        // Débranchement seulement : le watcher est partagé.
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        for (const [obj, prop] of [[this._watcher, '_changedId'],
                                   [this._watcher, '_positionId'],
                                   [this._lyrics, '_lyricsId']]) {
            if (this[prop]) {
                obj.disconnect(this[prop]);
                this[prop] = 0;
            }
        }
    }
});
