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

const COVER_W = 34;
const COVER_H = 48;
const AVATAR_SIZE = 46;
const BANNER_H = 96;
const LOGO_SIZE = 22;

const CACHE_DIR = GLib.build_filenamev(
    [GLib.get_user_cache_dir(), 'material-you-gnome', 'anilist']);

/* Les alias `anime:` et `manga:` évitent deux allers-retours. On ne demande que
 * les champs affichés : AniList applique un quota, autant ne pas le gaspiller. */
const QUERY = `query ($name: String) {
  User(name: $name) {
    name
    siteUrl
    avatar { large }
    bannerImage
    statistics { anime { count } manga { count } }
  }
  anime: MediaListCollection(userName: $name, type: ANIME, status: CURRENT) {
    lists { entries { progress updatedAt
      media { title { romaji english } episodes siteUrl coverImage { medium }
              nextAiringEpisode { episode timeUntilAiring } } } }
  }
  manga: MediaListCollection(userName: $name, type: MANGA, status: CURRENT) {
    lists { entries { progress updatedAt
      media { title { romaji english } chapters siteUrl coverImage { medium } } } }
  }
}`;

export const AniList = GObject.registerClass(
class AniList extends St.BoxLayout {
    _init(extension) {
        // Le logo est embarqué plutôt que téléchargé : il ne change pas, et
        // c'est une requête réseau de moins au démarrage.
        AniList.logoPath = GLib.build_filenamev([extension.path, 'assets', 'anilist.svg']);

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

    /* Ouvre une fiche AniList dans le navigateur par défaut. */
    _open(url) {
        if (!url)
            return;
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            logError(e, 'material-you-gnome: ouverture d\'un lien AniList');
        }
    }

    /* Habille un contenu d'un bouton plat cliquable. On n'utilise St.Button que
     * lorsqu'il y a une URL : sans lien, un curseur main serait mensonger. */
    _linked(child, url, styleClass) {
        if (!url)
            return child;

        const button = new St.Button({
            style_class: styleClass,
            child,
            can_focus: true,
            x_expand: true,
        });
        button.connect('clicked', () => this._open(url));
        return button;
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
                    url: entry.media?.siteUrl ?? '',
                    airing: entry.media?.nextAiringEpisode ?? null,
                    updated: entry.updatedAt ?? 0,
                    unit,
                }))
                .sort((a, b) => b.updated - a.updated);

        const user = data?.User;

        return {
            profile: user ? {
                name: user.name ?? '',
                url: user.siteUrl ?? '',
                avatar: user.avatar?.large ?? '',
                banner: user.bannerImage ?? '',
                animeCount: user.statistics?.anime?.count ?? 0,
                mangaCount: user.statistics?.manga?.count ?? 0,
            } : null,
            anime: take(data?.anime, 'ép', 'episodes'),
            manga: take(data?.manga, 'ch', 'chapters'),
        };
    }

    /* --- Affichage ---------------------------------------------------------- */

    _apply({profile = null, anime = [], manga = []} = {}) {
        const wasVisible = this.visible;
        this.destroy_all_children();

        if (!profile) {
            this.visible = false;
            if (wasVisible)
                this.notify('visible');
            return;
        }

        this.add_child(this._header(profile));
        this.add_child(this._columns(anime, manga));

        this.visible = true;
        if (!wasVisible)
            this.notify('visible');
    }

    /* Bandeau : la bannière en fond, un dégradé par-dessus pour que le texte
     * reste lisible quelle que soit l'image, puis l'avatar et les compteurs.
     * Le dégradé descend vers la couleur de la carte, ce qui fond le bandeau
     * dans le reste au lieu de le poser comme une vignette rapportée. */
    _header(profile) {
        const header = new St.Widget({
            style_class: 'myg-anilist-banner',
            layout_manager: new Clutter.BinLayout(),
            height: BANNER_H,
        });

        if (profile.banner)
            this._loadImage(header, profile.banner, 'banner');

        header.add_child(new St.Widget({
            style_class: 'myg-anilist-fade',
            x_expand: true,
            y_expand: true,
        }));

        const row = new St.BoxLayout({
            style_class: 'myg-anilist-identity',
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
        });

        const avatar = new St.Widget({
            style_class: 'myg-anilist-avatar',
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (profile.avatar)
            this._loadImage(avatar, profile.avatar, 'avatar');
        row.add_child(avatar);

        const text = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        text.add_child(new St.Label({
            text: profile.name,
            style_class: 'myg-anilist-user',
        }));
        text.add_child(new St.Label({
            text: `${profile.animeCount} animes · ${profile.mangaCount} mangas`,
            style_class: 'myg-anilist-counts',
        }));
        row.add_child(text);

        // Logo de la marque, au bout de la rangée. Dans le BinLayout du
        // bandeau, `x_align: END` ne le poussait pas au bord ; ici c'est
        // l'expansion du bloc texte qui s'en charge, ce qui marche.
        // Il garde sa couleur d'origine : c'est une identité, pas un élément
        // d'interface à accorder à la palette.
        const logo = new St.Widget({
            style_class: 'myg-anilist-logo',
            width: LOGO_SIZE,
            height: LOGO_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        });
        logo.set_style(
            `background-image: url("file://${AniList.logoPath}"); background-size: contain;`);
        row.add_child(logo);

        header.add_child(this._linked(row, profile.url, 'myg-anilist-link'));
        return header;
    }

    /* Deux colonnes plutôt qu'une liste : on compare d'un coup d'œil où en sont
     * les deux côtés. Les titres sont coupés — à cette largeur, aucun ne tient
     * en entier, et tronquer vaut mieux que rétrécir la police. */
    _columns(anime, manga) {
        const count = this._settings.get_int('anilist-count');
        const columns = new St.BoxLayout({style_class: 'myg-anilist-columns'});

        for (const [label, entries] of [['Animes', anime], ['Mangas', manga]]) {
            const column = new St.BoxLayout({
                vertical: true,
                style_class: 'myg-anilist-column',
                x_expand: true,
            });

            column.add_child(new St.Label({
                text: label,
                style_class: 'myg-anilist-section',
            }));

            if (!entries.length) {
                column.add_child(new St.Label({
                    text: '—',
                    style_class: 'myg-anilist-progress',
                }));
            }

            for (const entry of entries.slice(0, count))
                column.add_child(this._row(entry));

            columns.add_child(column);
        }

        return columns;
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
        this._loadImage(cover, entry.cover);
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
        // pas le connaître. Quand AniList annonce la prochaine diffusion, on
        // l'ajoute — c'est l'information qu'on cherche sur une série suivie.
        let progress = `${entry.unit} ${entry.progress}`;
        if (entry.total)
            progress += ` / ${entry.total}`;

        const soon = this._countdown(entry.airing);
        if (soon)
            progress += ` · ${soon}`;

        text.add_child(new St.Label({
            text: progress,
            style_class: entry.airing ? 'myg-anilist-progress airing' : 'myg-anilist-progress',
        }));

        row.add_child(text);
        return this._linked(row, entry.url, 'myg-anilist-link');
    }

    /* « dans 3 j » ou « dans 5 h » : au-delà d'une journée, l'heure exacte
     * n'apporte rien, et en deçà le nombre de jours vaudrait toujours zéro. */
    _countdown(airing) {
        if (!airing?.timeUntilAiring || airing.timeUntilAiring <= 0)
            return null;

        const hours = Math.floor(airing.timeUntilAiring / 3600);
        if (hours < 1)
            return 'imminent';
        if (hours < 24)
            return `dans ${hours} h`;
        return `dans ${Math.floor(hours / 24)} j`;
    }

    /* Jaquettes, avatar et bannière passent tous par ici. Le cache porte un nom
     * dérivé de l'URL : la liste est relue toutes les demi-heures, il serait
     * absurde de retélécharger les mêmes images. */
    _loadImage(actor, url, mode = 'cover') {
        if (!url)
            return;

        const target = GLib.build_filenamev([CACHE_DIR, this._hash(url)]);

        // La bannière est cadrée en `cover` comme le reste : `contain`
        // laisserait des bandes selon le ratio de l'image choisie par
        // l'utilisateur.
        const paint = () => actor.set_style(
            `background-image: url("file://${target}"); background-size: cover;`);
        void mode;

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
