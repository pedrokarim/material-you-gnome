/* Paroles synchronisées.
 *
 * Équivalent de services/LyricsService.qml, qui délègue à scripts/lyrics/lyrics.py.
 * Même source : lrclib.net — API publique, sans clé ni compte. `/api/get` d'abord
 * (correspondance exacte titre + artiste + durée), `/api/search` en repli quand
 * les métadonnées du lecteur ne collent pas au catalogue.
 *
 * Résultats mis en cache sur disque, y compris les échecs : sans marqueur
 * d'absence, chaque vidéo YouTube sans paroles relancerait deux requêtes à
 * chaque changement de propriété MPRIS — et elles arrivent en rafale.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {getWatcher} from './mpris.js';

const CACHE_DIR = GLib.build_filenamev(
    [GLib.get_user_cache_dir(), 'material-you-gnome', 'lyrics']);

// Marqueur « cherché, rien trouvé » — un fichier vide serait ambigu avec un
// téléchargement interrompu.
const NOT_FOUND = '#none';

/* GJS n'expose ni URLSearchParams ni URL (vérifié : les deux sont `undefined`
 * en 1.80). Seul encodeURIComponent est disponible. */
function query(params) {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
}

export const LyricsService = GObject.registerClass({
    Signals: {'changed': {}},
}, class LyricsService extends GObject.Object {
    _init() {
        super._init();

        this._lines = null;    // [{time, text}] trié, ou null
        this._key = null;      // piste pour laquelle _lines est valable
        this._settled = false; // vrai une fois la recherche terminée

        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();

        this._watcher = getWatcher();
        this._changedId = this._watcher.connect('changed', () => this._onTrack());

        this._onTrack();
    }

    /* null si aucune parole synchronisée n'est disponible. */
    get lines() {
        return this._lines;
    }

    /* Faux tant qu'une recherche est en vol : permet de distinguer « pas encore
     * cherché » de « cherché, rien trouvé ». */
    get settled() {
        return this._settled;
    }

    /* Index de la ligne en cours, ou -1 avant la première. */
    indexAt(seconds) {
        if (!this._lines)
            return -1;

        // Recherche linéaire depuis la fin : les paroles font quelques dizaines
        // de lignes, un tri binaire n'apporterait rien de mesurable.
        for (let i = this._lines.length - 1; i >= 0; i--) {
            if (seconds >= this._lines[i].time)
                return i;
        }
        return -1;
    }

    /* --- Cycle de vie ------------------------------------------------------- */

    _onTrack() {
        const track = this._watcher.track;
        if (!track) {
            this._set(null, null);
            return;
        }

        const key = `${track.artist} ${track.title} ${Math.floor(track.length)}`;
        if (key === this._key)
            return;   // même piste : les propriétés MPRIS changent souvent

        this._key = key;
        this._lines = null;
        this._settled = false;
        this.emit('changed');

        const cached = this._readCache(key);
        if (cached !== null) {
            this._set(key, cached === NOT_FOUND ? null : this._parse(cached));
            return;
        }

        this._fetch(track, key);
    }

    _set(key, lines) {
        this._key = key;
        this._lines = lines;
        this._settled = true;
        this.emit('changed');
    }

    /* --- Réseau ------------------------------------------------------------- */

    _fetch(track, key) {
        if (!track.title || !track.artist) {
            this._writeCache(key, NOT_FOUND);
            this._set(key, null);
            return;
        }

        // Artiste principal seulement : lrclib indexe par artiste crédité en
        // premier, une chaîne « A, B » ne correspond à rien chez eux.
        const params = query({
            track_name: track.title,
            artist_name: track.artists?.[0] ?? track.artist,
            album_name: track.album,
            duration: track.length > 0 ? Math.floor(track.length) : null,
        });

        this._get(`https://lrclib.net/api/get?${params}`, json => {
            const synced = json?.syncedLyrics;
            if (synced) {
                this._writeCache(key, synced);
                this._set(key, this._parse(synced));
                return;
            }
            this._search(track, key);
        }, () => this._search(track, key));
    }

    /* Repli : les lecteurs web annoncent souvent « Titre - Artiste » dans le
     * titre et rien d'exploitable en artiste, ce qui fait échouer /api/get. */
    _search(track, key) {
        const primary = track.artists?.[0] ?? track.artist;
        const params = query({q: `${track.title} ${primary}`.trim()});

        this._get(`https://lrclib.net/api/search?${params}`, json => {
            const hit = Array.isArray(json)
                ? json.find(entry => entry?.syncedLyrics)
                : null;

            if (hit) {
                this._writeCache(key, hit.syncedLyrics);
                this._set(key, this._parse(hit.syncedLyrics));
            } else {
                this._writeCache(key, NOT_FOUND);
                this._set(key, null);
            }
        }, () => {
            // Échec réseau : on ne met PAS en cache, pour réessayer plus tard.
            this._set(key, null);
        });
    }

    _get(url, onJson, onError) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append(
            'User-Agent', 'material-you-gnome (https://github.com/pedrokarim/material-you-gnome)');

        this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
                try {
                    const bytes = session.send_and_read_finish(res);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    onJson(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (e) {
                    onError();
                }
            });
    }

    /* --- LRC ---------------------------------------------------------------- */

    /* Format LRC : `[mm:ss.xx] texte`, avec parfois plusieurs horodatages sur la
     * même ligne quand un vers se répète. */
    _parse(lrc) {
        const lines = [];
        const stamp = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

        for (const raw of lrc.split('\n')) {
            const text = raw.replace(/\[[^\]]*\]/g, '').trim();

            // Les LRC horodatent aussi les silences, avec un texte vide. Les
            // garder ferait disparaître la surbrillance à chaque pause : mieux
            // vaut laisser la dernière ligne chantée allumée.
            if (!text)
                continue;

            let m;
            stamp.lastIndex = 0;
            while ((m = stamp.exec(raw)) !== null) {
                lines.push({
                    time: parseInt(m[1], 10) * 60 + parseFloat(m[2]),
                    text,
                });
            }
        }

        if (!lines.length)
            return null;

        lines.sort((a, b) => a.time - b.time);
        return lines;
    }

    /* --- Cache -------------------------------------------------------------- */

    _cachePath(key) {
        let h = 5381;
        for (let i = 0; i < key.length; i++)
            h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
        return GLib.build_filenamev([CACHE_DIR, `${h.toString(16)}.lrc`]);
    }

    _readCache(key) {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._cachePath(key));
            return ok ? new TextDecoder().decode(bytes) : null;
        } catch (e) {
            return null;
        }
    }

    _writeCache(key, content) {
        try {
            GLib.mkdir_with_parents(CACHE_DIR, 0o755);
            GLib.file_set_contents(this._cachePath(key), content);
        } catch (e) {
            // Cache indisponible : on se contente de refaire la requête.
        }
    }

    destroy() {
        this._cancellable.cancel();
        if (this._changedId) {
            this._watcher.disconnect(this._changedId);
            this._changedId = 0;
        }
    }
});

let service = null;

export function getLyrics() {
    if (!service)
        service = new LyricsService();
    return service;
}

export function releaseLyrics() {
    service?.destroy();
    service = null;
}
