/* Suivi du lecteur MPRIS courant, partagé par la barre et la carte bureau.
 *
 * Équivalent de services/MprisController.qml chez illogical-impulse. Extrait
 * ici parce que deux surfaces en ont besoin : dupliquer la découverte D-Bus
 * signifierait deux abonnements NameOwnerChanged et deux proxys pour le même
 * lecteur.
 *
 * Émet `changed` dès qu'une propriété bouge ou que le lecteur change. Les
 * consommateurs lisent `track` et appellent les commandes ; ils n'ont jamais à
 * toucher D-Bus.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';

// MPRIS n'émet PAS de PropertiesChanged pour Position : la seule façon de
// suivre l'avancement est de la sonder. Une fois par seconde suffit pour
// synchroniser des paroles, et on ne sonde que pendant la lecture.
const POSITION_POLL_SECONDS = 1;

export const MprisWatcher = GObject.registerClass({
    Signals: {'changed': {}, 'position': {}},
}, class MprisWatcher extends GObject.Object {
    _init() {
        super._init();

        this._proxy = null;
        this._busName = null;
        this._propsId = 0;
        this._position = 0;
        this._positionTimer = 0;

        this._nameOwnerId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', MPRIS_PREFIX,
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            () => this._findPlayer());

        this._findPlayer();
    }

    /* --- Lecture ----------------------------------------------------------- */

    /* null quand aucun lecteur n'expose de piste. Les consommateurs s'en
     * servent pour se masquer. */
    get track() {
        if (!this._proxy)
            return null;

        const meta = this._proxy.get_cached_property('Metadata')?.deepUnpack() ?? {};
        const title = meta['xesam:title']?.deepUnpack() ?? '';
        if (!title)
            return null;

        const artistRaw = meta['xesam:artist']?.deepUnpack() ?? [];
        const artist = Array.isArray(artistRaw) ? artistRaw.join(', ') : String(artistRaw);

        return {
            title,
            artist,
            album: meta['xesam:album']?.deepUnpack() ?? '',
            artUrl: meta['mpris:artUrl']?.deepUnpack() ?? '',
            // mpris:length est en microsecondes.
            length: (meta['mpris:length']?.deepUnpack() ?? 0) / 1e6,
            playing: (this._proxy.get_cached_property('PlaybackStatus')
                ?.deepUnpack() ?? 'Stopped') === 'Playing',
        };
    }

    /* Dernière position connue, en secondes. */
    get position() {
        return this._position;
    }

    /* --- Suivi de la position ---------------------------------------------- */

    _syncPositionTimer() {
        const shouldPoll = Boolean(this.track?.playing);

        if (shouldPoll && !this._positionTimer) {
            this._positionTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, POSITION_POLL_SECONDS, () => {
                    this._pollPosition();
                    return GLib.SOURCE_CONTINUE;
                });
            this._pollPosition();
        } else if (!shouldPoll && this._positionTimer) {
            GLib.Source.remove(this._positionTimer);
            this._positionTimer = 0;
        }
    }

    /* Position ne figure pas dans le cache du proxy — elle n'est jamais
     * notifiée — donc il faut un Get explicite à chaque fois. */
    _pollPosition() {
        if (!this._proxy || !this._busName)
            return;

        Gio.DBus.session.call(
            this._busName, OBJECT_PATH,
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (bus, res) => {
                try {
                    const [value] = bus.call_finish(res).deepUnpack();
                    this._position = value.deepUnpack() / 1e6;
                    this.emit('position');
                } catch (e) {
                    // Lecteur parti ou propriété non exposée : on laisse la
                    // dernière valeur, le prochain tick corrigera.
                }
            });
    }

    /* --- Commandes --------------------------------------------------------- */

    playPause() { this._call('PlayPause'); }
    next() { this._call('Next'); }
    previous() { this._call('Previous'); }

    _call(method) {
        this._proxy?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    /* --- Découverte -------------------------------------------------------- */

    _findPlayer() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (bus, res) => {
                let names;
                try {
                    [names] = bus.call_finish(res).deepUnpack();
                } catch (e) {
                    logError(e, 'material-you-gnome: ListNames');
                    return;
                }

                const player = names.find(n => n.startsWith(MPRIS_PREFIX));
                if (!player) {
                    this._release();
                    this._onChanged();
                    return;
                }
                if (player !== this._busName)
                    this._attach(player);
            });
    }

    _attach(busName) {
        this._release();
        this._busName = busName;

        Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
            busName, OBJECT_PATH, PLAYER_IFACE, null,
            (_src, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    logError(e, `material-you-gnome: proxy MPRIS ${busName}`);
                    this._busName = null;
                    return;
                }
                this._propsId = this._proxy.connect(
                    'g-properties-changed', () => this._onChanged());
                this._onChanged();
            });
    }

    /* Lâche le lecteur courant. L'abonnement à NameOwnerChanged survit : c'est
     * lui qui annoncera le suivant. */
    _release() {
        if (this._proxy && this._propsId) {
            this._proxy.disconnect(this._propsId);
            this._propsId = 0;
        }
        this._proxy = null;
        this._busName = null;
    }

    /* Un seul point d'émission : il porte aussi le pilotage du sondage de
     * position, qui dépend de l'état de lecture. */
    _onChanged() {
        this._syncPositionTimer();
        this.emit('changed');
    }

    destroy() {
        if (this._positionTimer) {
            GLib.Source.remove(this._positionTimer);
            this._positionTimer = 0;
        }
        this._release();
        if (this._nameOwnerId) {
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerId);
            this._nameOwnerId = 0;
        }
    }
});

/* Une seule instance pour toute l'extension : c'est le point de l'extraction.
 * Créée à la demande, détruite par extension.js au disable(). */
let watcher = null;

export function getWatcher() {
    if (!watcher)
        watcher = new MprisWatcher();
    return watcher;
}

export function releaseWatcher() {
    watcher?.destroy();
    watcher = null;
}
