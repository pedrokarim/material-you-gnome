/* Séries en cours sur AniList.
 *
 * Pas d'équivalent chez illogical-impulse — ils ont un navigateur d'images
 * booru, pas un suivi de visionnage. C'est un ajout.
 *
 * Source : l'API GraphQL publique d'AniList, sans authentification ni clé. Une
 * seule requête ramène animes et mangas grâce aux alias GraphQL ; les deux
 * listes sont ensuite fusionnées et triées par date de mise à jour.
 *
 * Désactivé par défaut, et muet tant qu'aucun pseudo n'est renseigné : rien
 * n'est envoyé sur le réseau sans que l'utilisateur l'ait demandé.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';

const ENDPOINT = 'https://graphql.anilist.co';

// Les listes bougent au rythme d'un épisode par jour au mieux : inutile de
// solliciter l'API plus souvent.
const REFRESH_SECONDS = 1800;

const COVER_W = 40;
const COVER_H = 56;

const CACHE_DIR = GLib.build_filenamev(
    [GLib.get_user_cache_dir(), 'material-you-gnome', 'anilist']);

/* Les alias `anime:` et `manga:` évitent deux allers-retours. On ne demande que
 * les champs affichés : AniList applique un quota, autant ne pas le gaspiller. */
const QUERY = `query ($name: String) {
  anime: MediaListCollection(userName: $name, type: ANIME, status: CURRENT) {
    lists { entries { progress updatedAt
      media { title { romaji english } episodes coverImage { medium } } } }
  }
  manga: MediaListCollection(userName: $name, type: MANGA, status: CURRENT) {
    lists { entries { progress updatedAt
      media { title { romaji english } chapters coverImage { medium } } } }
  }
}`;

export const AniList = GObject.registerClass(
class AniList extends St.BoxLayout {
    _init(extension) {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-anilist',
            reactive: false,
        });

        this._settings = extension.getSettings();
        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();

        this.visible = false;

        this._settingsIds = ['anilist-user', 'anilist-count'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._fetch()));

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._fetch();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._fetch();
    }

    get anchor() {
        return 'top-right';
    }

    /* --- Réseau ------------------------------------------------------------ */

    _fetch() {
        const user = this._settings.get_string('anilist-user').trim();
        if (!user) {
            this._apply([]);
            return;
        }

        const message = Soup.Message.new('POST', ENDPOINT);
        message.request_headers.append('Accept', 'application/json');

        const body = JSON.stringify({query: QUERY, variables: {name: user}});
        message.set_request_body_from_bytes(
            'application/json', new GLib.Bytes(new TextEncoder().encode(body)));

        this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
                let json;
                try {
                    const bytes = session.send_and_read_finish(res);
                    json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                } catch (e) {
                    return;   // hors ligne : on garde l'affichage précédent
                }

                if (json?.errors) {
                    // Pseudo inconnu, profil privé… : on se masque plutôt que
                    // d'afficher un message d'erreur sur le bureau.
                    this._apply([]);
                    return;
                }

                this._apply(this._parse(json?.data));
            });
    }

    /* Les deux collections ont la même forme à un champ près — `episodes` d'un
     * côté, `chapters` de l'autre. On les garde séparées : l'intérêt est de
     * voir d'un coup d'œil où en sont les deux, pas d'avoir un fil mêlé. */
    _parse(data) {
        const take = (collection, unit, total) =>
            (collection?.lists ?? []).flatMap(list => list.entries ?? [])
                .map(entry => ({
                    title: entry.media?.title?.english
                        || entry.media?.title?.romaji || '—',
                    progress: entry.progress ?? 0,
                    total: entry.media?.[total] ?? null,
                    cover: entry.media?.coverImage?.medium ?? '',
                    updated: entry.updatedAt ?? 0,
                    unit,
                }))
                .sort((a, b) => b.updated - a.updated);

        return {
            anime: take(data?.anime, 'ép', 'episodes'),
            manga: take(data?.manga, 'ch', 'chapters'),
        };
    }

    /* --- Affichage ---------------------------------------------------------- */

    _apply({anime = [], manga = []} = {}) {
        const wasVisible = this.visible;
        this.destroy_all_children();

        const count = this._settings.get_int('anilist-count');
        const user = this._settings.get_string('anilist-user').trim();

        if (anime.length + manga.length === 0) {
            this.visible = false;
            if (wasVisible)
                this.notify('visible');
            return;
        }

        // En-tête : le pseudo et le nombre de séries en cours de chaque côté.
        const header = new St.BoxLayout({style_class: 'myg-anilist-header'});
        header.add_child(new St.Label({
            text: user,
            style_class: 'myg-anilist-user',
            x_expand: true,
        }));
        header.add_child(new St.Label({
            text: `${anime.length} anime${anime.length > 1 ? 's' : ''}`
                + ` · ${manga.length} manga${manga.length > 1 ? 's' : ''}`,
            style_class: 'myg-anilist-counts',
        }));
        this.add_child(header);

        for (const [label, entries] of [['Animes', anime], ['Mangas', manga]]) {
            if (!entries.length)
                continue;

            this.add_child(new St.Label({
                text: label,
                style_class: 'myg-anilist-section',
            }));
            for (const entry of entries.slice(0, count))
                this.add_child(this._row(entry));
        }

        this.visible = true;
        if (!wasVisible)
            this.notify('visible');
    }

    _row(entry) {
        const row = new St.BoxLayout({style_class: 'myg-anilist-row'});

        // Même technique que la pochette du lecteur : un fond plutôt qu'une
        // icône, seule façon d'obtenir des coins arrondis sous St.
        const cover = new St.Widget({
            style_class: 'myg-anilist-cover',
            width: COVER_W,
            height: COVER_H,
        });
        this._loadCover(cover, entry.cover);
        row.add_child(cover);

        const text = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'myg-anilist-text',
            x_expand: true,
        });

        const title = new St.Label({
            text: entry.title,
            style_class: 'myg-anilist-title',
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        title.clutter_text.single_line_mode = true;
        text.add_child(title);

        // Le total est absent des séries en cours de diffusion : on ne prétend
        // pas le connaître.
        text.add_child(new St.Label({
            text: `${entry.unit} ${entry.progress}${entry.total ? ` / ${entry.total}` : ''}`,
            style_class: 'myg-anilist-progress',
        }));

        row.add_child(text);
        return row;
    }

    /* Les jaquettes sont mises en cache sous un nom dérivé de l'URL : la liste
     * est relue toutes les demi-heures, il serait absurde de les retélécharger. */
    _loadCover(actor, url) {
        if (!url)
            return;

        const target = GLib.build_filenamev([CACHE_DIR, this._hash(url)]);

        const paint = () => actor.set_style(
            `background-image: url("file://${target}"); background-size: cover;`);

        if (GLib.file_test(target, GLib.FileTest.EXISTS)) {
            paint();
            return;
        }

        Gio.File.new_for_uri(url).load_contents_async(this._cancellable, (file, res) => {
            try {
                const [, bytes] = file.load_contents_finish(res);
                GLib.mkdir_with_parents(CACHE_DIR, 0o755);
                GLib.file_set_contents(target, bytes);
                paint();
            } catch (e) {
                // Jaquette indisponible : la case reste vide, la ligne tient.
            }
        });
    }

    /* djb2 : il ne s'agit que de nommer un fichier de cache. */
    _hash(text) {
        let h = 5381;
        for (let i = 0; i < text.length; i++)
            h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
        return h.toString(16);
    }

    _onDestroy() {
        this._cancellable.cancel();

        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
