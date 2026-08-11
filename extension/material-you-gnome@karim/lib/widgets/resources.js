/* Cartes de ressources — CPU, mémoire, disque.
 *
 * Reprend widgets/resources/ResourcesWidget.qml : trois tuiles avec une icône
 * en pastille, un gros pourcentage et un libellé. Contrairement à l'horloge,
 * rien n'est dessiné en Cairo — ce sont des rectangles arrondis, donc du St
 * classique piloté par la feuille de style.
 *
 * Les mesures viennent de /proc et de GIO. Aucune dépendance externe : `top`,
 * `free` ou `df` seraient des processus lancés toutes les 5 secondes.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const REFRESH_SECONDS = 5;

// Le disque bouge lentement : inutile d'interroger le système de fichiers à
// chaque tick.
const DISK_EVERY = 12;   // soit une minute

const Card = GObject.registerClass(
class Card extends St.BoxLayout {
    _init(iconName, label) {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-res-card',
        });

        const top = new St.BoxLayout({style_class: 'myg-card-top'});
        top.add_child(new St.Widget({x_expand: true}));
        top.add_child(new St.Icon({
            icon_name: iconName,
            style_class: 'myg-card-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.add_child(top);

        this._value = new St.Label({text: '—', style_class: 'myg-card-value'});
        this.add_child(this._value);
        this.add_child(new St.Label({text: label, style_class: 'myg-card-label'}));
    }

    setPercent(percent) {
        this._value.text = percent === null ? '—' : `${Math.round(percent)} %`;
    }
});

export const Resources = GObject.registerClass(
class Resources extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'myg-res-row',
            reactive: false,
        });

        this._cpu = new Card('utilities-system-monitor-symbolic', 'CPU');
        this._ram = new Card('drive-harddisk-solidstate-symbolic', 'RAM');
        this._disk = new Card('drive-harddisk-symbolic', 'Disque');

        this.add_child(this._cpu);
        this.add_child(this._ram);
        this.add_child(this._disk);

        // La batterie n'apparaît que s'il y en a une : sur une tour, une carte
        // « — » permanente serait du bruit.
        this._batteryPath = this._findBattery();
        if (this._batteryPath) {
            this._battery = new Card('battery-symbolic', 'Batterie');
            this.add_child(this._battery);
        }

        this._prevCpu = null;
        this._tick = 0;

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._refresh();
    }

    // Placée par lib/desktop.js, qui l'empile sous la carte météo puisqu'elles
    // partagent la même ancre.
    get anchor() {
        return 'top-right';
    }

    _refresh() {
        this._cpu.setPercent(this._readCpu());
        this._ram.setPercent(this._readMemory());

        if (this._tick % DISK_EVERY === 0)
            this._disk.setPercent(this._readDisk());
        this._battery?.setPercent(this._readBattery());
        this._tick++;
    }

    /* --- Mesures ----------------------------------------------------------- */

    /* /proc/stat donne des compteurs cumulés depuis le démarrage : le taux
     * d'occupation ne se lit donc que par différence entre deux relevés. Le
     * premier appel ne peut rien renvoyer. */
    _readCpu() {
        const line = this._firstLine('/proc/stat');
        if (!line)
            return null;

        const parts = line.split(/\s+/).slice(1).map(Number);
        if (parts.length < 5)
            return null;

        const idle = parts[3] + parts[4];             // idle + iowait
        const total = parts.reduce((a, b) => a + b, 0);

        const prev = this._prevCpu;
        this._prevCpu = {idle, total};
        if (!prev)
            return null;

        const dTotal = total - prev.total;
        const dIdle = idle - prev.idle;
        if (dTotal <= 0)
            return null;

        return (1 - dIdle / dTotal) * 100;
    }

    /* MemAvailable, pas MemFree : le noyau compte le cache réclamable comme
     * disponible, ce qui reflète la mémoire réellement utilisable. */
    _readMemory() {
        const text = this._read('/proc/meminfo');
        if (!text)
            return null;

        const grab = key => {
            const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
            return m ? Number(m[1]) : null;
        };

        const total = grab('MemTotal');
        const available = grab('MemAvailable');
        if (!total || available === null)
            return null;

        return (1 - available / total) * 100;
    }

    _readDisk() {
        try {
            const info = Gio.File.new_for_path('/').query_filesystem_info(
                'filesystem::size,filesystem::used', null);
            const size = info.get_attribute_uint64('filesystem::size');
            const used = info.get_attribute_uint64('filesystem::used');
            if (!size)
                return null;
            return (used / size) * 100;
        } catch (e) {
            return null;
        }
    }

    /* /sys/class/power_supply expose aussi l'adaptateur secteur et les ports
     * USB-C : on ne retient que ce qui se déclare « Battery ». */
    _findBattery() {
        for (const name of ['BAT0', 'BAT1', 'BAT2']) {
            const dir = `/sys/class/power_supply/${name}`;
            if (GLib.file_test(`${dir}/capacity`, GLib.FileTest.EXISTS))
                return dir;
        }
        return null;
    }

    _readBattery() {
        const raw = this._read(`${this._batteryPath}/capacity`);
        if (!raw)
            return null;
        const value = parseInt(raw.trim(), 10);
        return Number.isFinite(value) ? value : null;
    }

    _read(path) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            return ok ? new TextDecoder().decode(bytes) : null;
        } catch (e) {
            return null;
        }
    }

    _firstLine(path) {
        const text = this._read(path);
        return text ? text.split('\n', 1)[0] : null;
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
