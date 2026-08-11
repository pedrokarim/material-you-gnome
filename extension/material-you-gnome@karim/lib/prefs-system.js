/* Page « Système » du panneau de réglages.
 *
 * Équivalent de leur page HyprlandConfig, qui existe parce que Hyprland n'a
 * aucune application de réglages : tout vit dans hyprland.conf. GNOME en a une,
 * donc cette page ne réinvente rien — elle rassemble au même endroit ce qui,
 * chez eux, est réparti dans cet onglet.
 *
 * Deux sections de leur page n'ont volontairement pas d'équivalent :
 *
 *   - gaps, bordures, opacité, flou : notions propres à un compositeur pavant.
 *     Mutter ne les expose pas, et rien ne les émule.
 *   - layout dwindle / master : même raison.
 *
 * Les écrans restent en lecture seule. Mutter sait les reconfigurer via
 * ApplyMonitorsConfig, mais une configuration erronée laisse un écran noir :
 * on affiche l'état et on ouvre le panneau de GNOME, qui a la logique de
 * validation et le retour arrière temporisé.
 *
 * Ce module ne tire aucune dépendance de Shell : il tourne dans le processus
 * des préférences, où St et Clutter n'existent pas.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const AUTOSTART_DIR = GLib.build_filenamev(
    [GLib.get_user_config_dir(), 'autostart']);

const FOCUS_MODES = [
    ['click', 'Au clic'],
    ['sloppy', 'Au survol'],
    ['mouse', 'Au survol, sans mémoire'],
];

function openPanel(panel) {
    try {
        Gio.Subprocess.new(['gnome-control-center', panel],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        logError(e, 'material-you-gnome: gnome-control-center');
    }
}

function linkRow(title, subtitle, panel) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true});
    row.add_suffix(new Gtk.Image({icon_name: 'external-link-symbolic'}));
    row.connect('activated', () => openPanel(panel));
    return row;
}

export function systemPage() {
    const page = new Adw.PreferencesPage({
        title: 'Système',
        icon_name: 'preferences-system-symbolic',
    });

    page.add(displaysGroup());
    page.add(keyboardGroup());
    page.add(pointerGroup());
    page.add(windowsGroup());
    page.add(autostartGroup());

    return page;
}

/* --- Écrans ---------------------------------------------------------------- */

/* GetCurrentState renvoie une structure imbriquée : pour chaque moniteur, la
 * liste de ses modes, dont un seul porte `is-current`. C'est celui-là qui décrit
 * ce qui est réellement affiché. */
function displaysGroup() {
    const group = new Adw.PreferencesGroup({
        title: 'Écrans',
        description: 'En lecture seule — une configuration de moniteur erronée '
            + 'laisse un écran noir, GNOME a la validation et le retour arrière.',
    });

    let monitors = [];
    try {
        const reply = Gio.DBus.session.call_sync(
            'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig', 'GetCurrentState',
            null, null, Gio.DBusCallFlags.NONE, -1, null);
        monitors = reply.deepUnpack()[1] ?? [];
    } catch (e) {
        group.add(new Adw.ActionRow({
            title: 'Écrans',
            subtitle: 'Mutter n\'a pas répondu',
        }));
        return group;
    }

    for (const monitor of monitors) {
        const [spec, modes] = monitor;
        const [connector, vendor, product] = spec;

        const current = modes.find(mode => {
            const props = mode[6] ?? {};
            return props['is-current']?.deepUnpack() === true;
        });

        let subtitle = [vendor, product].filter(Boolean).join(' ');
        if (current) {
            const [, width, height, refresh, scale] = current;
            subtitle += ` · ${width}×${height} @ ${refresh.toFixed(2)} Hz · échelle ${scale}`;
        }

        group.add(new Adw.ActionRow({title: connector, subtitle}));
    }

    group.add(linkRow('Configurer les écrans',
        'Résolution, orientation, disposition', 'display'));
    return group;
}

/* --- Clavier ---------------------------------------------------------------- */

function keyboardGroup() {
    const settings = new Gio.Settings({schema: 'org.gnome.desktop.peripherals.keyboard'});
    const group = new Adw.PreferencesGroup({title: 'Clavier'});

    const sources = new Gio.Settings({schema: 'org.gnome.desktop.input-sources'})
        .get_value('sources').deepUnpack()
        .map(([, id]) => id).join(', ');
    group.add(linkRow('Disposition', sources || 'aucune', 'keyboard'));

    const repeat = new Adw.SwitchRow({
        title: 'Répétition des touches',
        subtitle: 'Maintenir une touche la répète',
    });
    settings.bind('repeat', repeat, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(repeat);

    // `delay` et `repeat-interval` sont des uint32 ; Adw.SpinRow travaille en
    // double, d'où la liaison manuelle plutôt qu'un settings.bind.
    group.add(uintRow(settings, 'delay', 'Délai avant répétition',
        'Millisecondes', 100, 2000, 10, repeat));
    group.add(uintRow(settings, 'repeat-interval', 'Vitesse de répétition',
        'Millisecondes entre deux répétitions', 5, 500, 5, repeat));

    return group;
}

function uintRow(settings, key, title, subtitle, lower, upper, step, dependsOn) {
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({
            lower, upper, step_increment: step, page_increment: step * 10,
        }),
    });
    row.value = settings.get_uint(key);
    row.connect('notify::value', () => settings.set_uint(key, row.value));

    // Le délai et la vitesse n'ont de sens que si la répétition est active.
    if (dependsOn) {
        dependsOn.bind_property('active', row, 'sensitive',
            GObject.BindingFlags.SYNC_CREATE);
    }
    return row;
}

/* --- Souris et pavé tactile ------------------------------------------------- */

function pointerGroup() {
    const touchpad = new Gio.Settings({schema: 'org.gnome.desktop.peripherals.touchpad'});
    const mouse = new Gio.Settings({schema: 'org.gnome.desktop.peripherals.mouse'});

    const group = new Adw.PreferencesGroup({title: 'Souris et pavé tactile'});

    const pairs = [
        [touchpad, 'natural-scroll', 'Défilement naturel (pavé tactile)', ''],
        [touchpad, 'tap-to-click', 'Taper pour cliquer', ''],
        [touchpad, 'disable-while-typing', 'Désactiver pendant la frappe', ''],
        [mouse, 'natural-scroll', 'Défilement naturel (souris)', ''],
    ];

    for (const [settings, key, title, subtitle] of pairs) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }

    return group;
}

/* --- Fenêtres --------------------------------------------------------------- */

function windowsGroup() {
    const wm = new Gio.Settings({schema: 'org.gnome.desktop.wm.preferences'});
    const iface = new Gio.Settings({schema: 'org.gnome.desktop.interface'});

    const group = new Adw.PreferencesGroup({
        title: 'Fenêtres',
        description: 'Gaps, bordures, opacité et flou sont propres aux '
            + 'compositeurs pavants — Mutter ne les expose pas.',
    });

    const focus = new Adw.ComboRow({
        title: 'Activation des fenêtres',
        model: Gtk.StringList.new(FOCUS_MODES.map(([, label]) => label)),
    });
    const keys = FOCUS_MODES.map(([key]) => key);
    focus.selected = Math.max(0, keys.indexOf(wm.get_string('focus-mode')));
    focus.connect('notify::selected',
        () => wm.set_string('focus-mode', keys[focus.selected]));
    group.add(focus);

    const animations = new Adw.SwitchRow({title: 'Animations'});
    iface.bind('enable-animations', animations, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(animations);

    return group;
}

/* --- Applications au démarrage ---------------------------------------------- */

/* Les .desktop d'autostart se désactivent par la clé X-GNOME-Autostart-enabled
 * plutôt qu'en supprimant le fichier : on peut revenir en arrière. */
function autostartGroup() {
    const group = new Adw.PreferencesGroup({
        title: 'Applications au démarrage',
        description: AUTOSTART_DIR,
    });

    let names = [];
    try {
        const dir = Gio.File.new_for_path(AUTOSTART_DIR);
        const iter = dir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = iter.next_file(null)) !== null) {
            if (info.get_name().endsWith('.desktop'))
                names.push(info.get_name());
        }
    } catch (e) {
        names = [];
    }

    if (!names.length) {
        group.add(new Adw.ActionRow({title: 'Aucune application au démarrage'}));
        return group;
    }

    for (const name of names.sort()) {
        const path = GLib.build_filenamev([AUTOSTART_DIR, name]);
        const keyFile = new GLib.KeyFile();

        let title = name;
        let enabled = true;
        try {
            keyFile.load_from_file(path, GLib.KeyFileFlags.KEEP_COMMENTS
                | GLib.KeyFileFlags.KEEP_TRANSLATIONS);
            title = keyFile.get_string('Desktop Entry', 'Name');
            enabled = keyFile.get_boolean('Desktop Entry', 'X-GNOME-Autostart-enabled');
        } catch (e) {
            // Clé absente : l'entrée est active par défaut, et le nom retombe
            // sur celui du fichier.
        }

        const row = new Adw.SwitchRow({title, subtitle: name, active: enabled});
        row.connect('notify::active', () => {
            try {
                keyFile.set_boolean('Desktop Entry', 'X-GNOME-Autostart-enabled', row.active);
                keyFile.save_to_file(path);
            } catch (e) {
                logError(e, `material-you-gnome: écriture de ${name}`);
            }
        });
        group.add(row);
    }

    return group;
}
