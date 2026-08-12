/* Appareils connectés et leur batterie.
 *
 * Souris, casques, claviers, manettes — tout ce qui rapporte un niveau de
 * charge. Pas d'équivalent chez illogical-impulse : c'est un ajout.
 *
 * Source : UPower, qui agrège déjà les batteries Bluetooth et USB — c'est ce
 * qu'utilise le panneau Énergie de GNOME. Interroger BlueZ en plus ne
 * rapporterait rien et manquerait les périphériques non Bluetooth.
 *
 * `IconName` de UPower n'est pas exploitable : il renvoie `battery-missing`
 * pour les périphériques Bluetooth. On mappe donc sur `Type`, qui est fiable.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';

const UPOWER = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';

// Les niveaux bougent lentement, et UPower ne notifie pas toujours : on relit
// périodiquement plutôt que de s'abonner à chaque appareil.
const REFRESH_SECONDS = 60;

/* Types UPower. On écarte 1 (secteur) et 2 (batterie interne, déjà dans la
 * carte des ressources) : ce widget parle des périphériques. */
const LINE_POWER = 1;
const INTERNAL_BATTERY = 2;

const ICONS = {
    5: 'input-mouse-symbolic',
    6: 'input-keyboard-symbolic',
    7: 'phone-symbolic',
    8: 'phone-symbolic',
    9: 'multimedia-player-symbolic',
    12: 'input-gaming-symbolic',
    13: 'input-tablet-symbolic',
    14: 'input-touchpad-symbolic',
    17: 'audio-headset-symbolic',
    18: 'audio-speakers-symbolic',
    19: 'audio-headphones-symbolic',
};

// Anneau de charge : trois paliers suffisent à situer un niveau d'un coup
// d'œil, un dégradé continu n'apporterait qu'une nuance illisible.
const RING_SIZE = 46;
const RING_WIDTH = 5;
const RING_FONT = 13;
const LEVEL_LOW = 20;
const LEVEL_MID = 50;

// État UPower 1 = en charge, 4 = pleine. Les périphériques Bluetooth rapportent
// souvent 0 (inconnu) : on n'affiche donc l'état que lorsqu'il dit quelque chose.
const CHARGING = 1;

/* Anneau de niveau. Dessiné en Cairo : St ne sait pas tracer d'arc, et un
 * dégradé d'images préparées serait figé alors que la palette change à chaque
 * fond d'écran. */
const BatteryRing = GObject.registerClass(
class BatteryRing extends St.DrawingArea {
    _init(percentage) {
        super._init({
            style_class: 'myg-device-ring',
            width: RING_SIZE,
            height: RING_SIZE,
            reactive: false,
        });

        this._percentage = percentage;
        this.connect('style-changed', () => this.queue_repaint());
        this.connect('repaint', () => this._draw());
    }

    _color(name) {
        const node = this.get_theme_node();
        const [found, color] = node.lookup_color(name, false);
        return found ? color : node.get_foreground_color();
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const radius = Math.min(w, h) / 2 - RING_WIDTH / 2;
        const cx = w / 2;
        const cy = h / 2;

        const level = this._percentage <= LEVEL_LOW ? '-myg-level-low'
            : this._percentage <= LEVEL_MID ? '-myg-level-mid'
            : '-myg-level-high';

        const use = color => cr.setSourceRGBA(
            color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);

        cr.setLineWidth(RING_WIDTH);

        // Piste complète en dessous : sans elle, un niveau bas ne se distingue
        // pas d'un widget qui n'aurait rien dessiné.
        use(this._color('-myg-level-track'));
        cr.arc(cx, cy, radius, 0, 2 * Math.PI);
        cr.stroke();

        // L'arc part de midi et tourne dans le sens horaire, comme une jauge.
        const sweep = Math.max(0, Math.min(100, this._percentage)) / 100;
        if (sweep > 0) {
            use(this._color(level));
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.arc(cx, cy, radius,
                   -Math.PI / 2,
                   -Math.PI / 2 + sweep * 2 * Math.PI);
            cr.stroke();
        }

        // Le chiffre au centre de l'anneau, pas à côté : c'est ce qui fait lire
        // l'ensemble comme une jauge plutôt que comme une icône et un nombre.
        use(this._color('-myg-level-text'));
        cr.selectFontFace('Readex Pro', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(RING_FONT);

        const text = String(Math.round(this._percentage));
        const ext = cr.textExtents(text);
        cr.moveTo(cx - (ext.width / 2 + ext.xBearing),
                  cy - (ext.height / 2 + ext.yBearing));
        cr.showText(text);
        cr.newPath();   // showText laisse la position courante dans le chemin

        cr.$dispose();
    }
});

export const Devices = GObject.registerClass(
class Devices extends St.BoxLayout {
    _init() {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-devices',
            reactive: false,
        });

        this._rows = new Map();   // chemin D-Bus → { icon, name, level }
        this.visible = false;

        this._cancellable = new Gio.Cancellable();

        // Un casque qu'on allume ou qu'on éteint doit apparaître ou disparaître
        // sans attendre le prochain relevé.
        this._watchIds = ['DeviceAdded', 'DeviceRemoved'].map(signal =>
            Gio.DBus.system.signal_subscribe(
                UPOWER, UPOWER, signal, UPOWER_PATH, null,
                Gio.DBusSignalFlags.NONE, () => this._refresh()));

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._refresh();
    }

    get anchor() {
        return 'top-right';
    }

    /* --- Collecte -------------------------------------------------------- */

    _refresh() {
        Gio.DBus.system.call(
            UPOWER, UPOWER_PATH, UPOWER, 'EnumerateDevices',
            null, new GLib.VariantType('(ao)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, res) => {
                let paths;
                try {
                    [paths] = bus.call_finish(res).deepUnpack();
                } catch (e) {
                    return;   // UPower absent : le widget reste masqué
                }
                this._readAll(paths);
            });
    }

    /* Chaque appareil demande son propre GetAll. On collecte tout avant de
     * redessiner, sinon la liste se réordonne au gré des réponses. */
    _readAll(paths) {
        const collected = [];
        let pending = paths.length;

        if (!pending) {
            this._apply([]);
            return;
        }

        for (const path of paths) {
            Gio.DBus.system.call(
                UPOWER, path, 'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', [DEVICE_IFACE]),
                new GLib.VariantType('(a{sv})'),
                Gio.DBusCallFlags.NONE, -1, this._cancellable,
                (bus, res) => {
                    try {
                        const [props] = bus.call_finish(res).deepUnpack();
                        const device = this._describe(path, props);
                        if (device)
                            collected.push(device);
                    } catch (e) {
                        // Appareil déconnecté entre l'énumération et la lecture.
                    }

                    if (--pending === 0)
                        this._apply(collected);
                });
        }
    }

    _describe(path, props) {
        const unpack = key => props[key]?.deepUnpack();

        const type = unpack('Type') ?? 0;
        if (type === LINE_POWER || type === INTERNAL_BATTERY)
            return null;
        if (unpack('IsPresent') !== true)
            return null;

        const percentage = unpack('Percentage');
        if (typeof percentage !== 'number')
            return null;

        const model = unpack('Model') || unpack('Vendor') || 'Appareil';

        return {
            path,
            name: model,
            percentage,
            charging: unpack('State') === CHARGING,
            icon: ICONS[type] ?? 'bluetooth-symbolic',
        };
    }

    /* --- Affichage -------------------------------------------------------- */

    _apply(devices) {
        devices.sort((a, b) => a.name.localeCompare(b.name));

        const wasVisible = this.visible;
        this.destroy_all_children();
        this._rows.clear();

        for (const device of devices)
            this.add_child(this._row(device));

        this.visible = devices.length > 0;
        if (this.visible !== wasVisible)
            this.notify('visible');
    }

    _row(device) {
        const row = new St.BoxLayout({style_class: 'myg-device-row'});

        row.add_child(new St.Icon({
            icon_name: device.icon,
            style_class: 'myg-device-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        row.add_child(new St.Label({
            text: device.name,
            style_class: 'myg-device-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        row.add_child(new BatteryRing(device.percentage));

        if (device.charging) {
            row.add_child(new St.Icon({
                icon_name: 'battery-full-charging-symbolic',
                style_class: 'myg-device-charging',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        return row;
    }

    _onDestroy() {
        this._cancellable.cancel();

        for (const id of this._watchIds ?? [])
            Gio.DBus.system.signal_unsubscribe(id);
        this._watchIds = [];

        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
