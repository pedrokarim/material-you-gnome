/* Carte utilisateur du bureau.
 *
 * Reprend widgets/usercard/UserCardWidget.qml : avatar, `user@host`, temps
 * depuis le démarrage, et trois actions — verrouiller, réglages, éteindre.
 *
 * Les actions passent par D-Bus plutôt que par les API internes du Shell
 * (`Main.screenShield`, `Main.panel.statusArea…`) : ces dernières changent au
 * fil des versions de GNOME, alors que org.gnome.ScreenSaver et
 * org.gnome.SessionManager sont des interfaces publiques et stables.
 *
 * `Shutdown()` ouvre la boîte de dialogue de confirmation de GNOME, il n'éteint
 * pas la machine sèchement.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {getWeather, CONDITIONS, quipFor} from '../weather-service.js';

const AVATAR_SIZE = 64;
const REFRESH_SECONDS = 60;   // l'uptime ne change pas plus vite qu'une minute

export const UserCard = GObject.registerClass(
class UserCard extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'myg-card myg-usercard',
            reactive: true,
        });

        this._avatar = new St.Widget({
            style_class: 'myg-usercard-avatar',
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._avatarFallback = new St.Icon({
            icon_name: 'avatar-default-symbolic',
            icon_size: 32,
        });
        this._avatar.add_child(this._avatarFallback);
        this._loadAvatar();
        this.add_child(this._avatar);

        const column = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'myg-usercard-text',
        });

        // Chez eux : `user@host`, sauf si le nom est déjà long — sinon la carte
        // s'étire pour rien.
        const user = GLib.get_user_name();
        const host = GLib.get_host_name();
        column.add_child(new St.Label({
            text: user.length > 10 ? user : `${user}@${host}`,
            style_class: 'myg-usercard-name',
        }));

        this._uptime = new St.Label({style_class: 'myg-usercard-sub'});
        column.add_child(this._uptime);

        // Phrase d'ambiance météo, comme chez eux. Elle lit le service partagé
        // avec la carte météo : pas de seconde requête HTTP pour une phrase.
        this._quipRow = new St.BoxLayout({style_class: 'myg-usercard-quip'});
        this._quipIcon = new St.Icon({
            icon_name: 'weather-clear-symbolic',
            icon_size: 13,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._quipText = new St.Label({
            style_class: 'myg-usercard-sub',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._quipRow.add_child(this._quipIcon);
        this._quipRow.add_child(this._quipText);
        this._quipRow.visible = false;
        column.add_child(this._quipRow);

        this._weather = getWeather();
        this._weatherId = this._weather.connect('changed', () => this._syncQuip());
        this._syncQuip();

        const actions = new St.BoxLayout({style_class: 'myg-usercard-actions'});
        actions.add_child(this._action('changes-prevent-symbolic', 'Verrouiller',
            () => this._lock()));
        actions.add_child(this._action('preferences-system-symbolic', 'Réglages',
            () => this._settings()));
        actions.add_child(this._action('system-shutdown-symbolic', 'Éteindre',
            () => this._shutdown()));
        column.add_child(actions);

        this.add_child(column);

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._syncUptime();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._syncUptime();
    }

    get anchor() {
        return 'top-right';
    }

    _action(iconName, tooltip, onClick) {
        const button = new St.Button({
            style_class: 'myg-usercard-button',
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
            can_focus: true,
            reactive: true,
        });
        button.set_accessible_name(tooltip);
        button.connect('clicked', onClick);
        return button;
    }

    /* --- Données ----------------------------------------------------------- */

    /* GNOME ne pose pas d'avatar par défaut : ni ~/.face ni le fichier
     * AccountsService n'existent tant que l'utilisateur n'en a pas choisi un.
     * D'où le repli sur une icône symbolique. */
    _loadAvatar() {
        const candidates = [
            GLib.build_filenamev([GLib.get_home_dir(), '.face']),
            GLib.build_filenamev([GLib.get_home_dir(), '.face.icon']),
            `/var/lib/AccountsService/icons/${GLib.get_user_name()}`,
        ];

        for (const path of candidates) {
            if (!GLib.file_test(path, GLib.FileTest.EXISTS))
                continue;
            this._avatarFallback.visible = false;
            this._avatar.set_style(
                `background-image: url("file://${path}"); background-size: cover;`);
            return;
        }
    }

    _syncUptime() {
        let seconds = 0;
        try {
            const [ok, bytes] = GLib.file_get_contents('/proc/uptime');
            if (ok)
                seconds = parseFloat(new TextDecoder().decode(bytes).split(' ')[0]);
        } catch (e) {
            this._uptime.text = '';
            return;
        }

        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        let text;
        if (days > 0)
            text = `${days} j ${hours} h`;
        else if (hours > 0)
            text = `${hours} h ${minutes} min`;
        else
            text = `${minutes} min`;

        this._uptime.text = `Allumé depuis ${text}`;
    }

    /* --- Actions ----------------------------------------------------------- */

    _callDBus(name, path, iface, method) {
        Gio.DBus.session.call(
            name, path, iface, method, null, null,
            Gio.DBusCallFlags.NONE, -1, null,
            (bus, res) => {
                try {
                    bus.call_finish(res);
                } catch (e) {
                    logError(e, `material-you-gnome: ${method} a échoué`);
                }
            });
    }

    _lock() {
        this._callDBus('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver',
                       'org.gnome.ScreenSaver', 'Lock');
    }

    /* Shutdown() n'éteint pas : il ouvre la confirmation de GNOME. */
    _shutdown() {
        this._callDBus('org.gnome.SessionManager', '/org/gnome/SessionManager',
                       'org.gnome.SessionManager', 'Shutdown');
    }

    _settings() {
        const app = Gio.DesktopAppInfo.new('org.gnome.Settings.desktop');
        try {
            app?.launch([], null);
        } catch (e) {
            logError(e, 'material-you-gnome: lancement des Réglages');
        }
    }

    /* Rien à afficher tant que le lieu n'est pas configuré ou que le premier
     * relevé n'est pas revenu : la ligne se masque plutôt que d'afficher un
     * gabarit vide. */
    _syncQuip() {
        const data = this._weather.data;
        const quip = data ? quipFor(data.code) : null;

        if (!quip) {
            this._quipRow.visible = false;
            return;
        }

        this._quipIcon.icon_name =
            CONDITIONS[data.code]?.[0] ?? 'weather-clear-symbolic';
        this._quipText.text = `• ${quip}`;
        this._quipRow.visible = true;
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        // Débranchement seulement : le service météo est partagé.
        if (this._weatherId) {
            this._weather.disconnect(this._weatherId);
            this._weatherId = 0;
        }
    }
});
