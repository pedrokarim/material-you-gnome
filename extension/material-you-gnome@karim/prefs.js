/* Panneau de réglages.
 *
 * Équivalent de modules/ii/settings/ chez illogical-impulse, dont la moitié des
 * pages (HyprlandConfig, NiriConfig…) n'a pas de sens ici. On garde ce qui se
 * traduit : les widgets du bureau, la barre, et un « à propos ».
 *
 * GNOME fournit le cadre — Adw.PreferencesWindow — donc il n'y a rien à
 * dessiner : uniquement la déclaration des réglages et leur liaison à GSettings.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {systemPage} from './lib/prefs-system.js';

const WIDGETS = [
    ['show-clock', 'Horloge', 'Cadran festonné, jour et mois'],
    ['show-quote', 'Citation', 'Petite bulle sous l\'horloge'],
    ['show-media', 'Carte média', 'Pochette, titre et transport'],
    ['show-calendar', 'Calendrier', 'Mois courant'],
    ['show-weather', 'Météo', 'Relevé Open-Meteo'],
    ['show-resources', 'Ressources', 'CPU, mémoire et disque'],
    ['show-usercard', 'Carte utilisateur', 'Session, temps d\'allumage, actions'],
    ['show-worldclocks', 'Horloges mondiales', 'Heure locale et fuseaux choisis'],
];

const CLOCK_STYLES = [
    ['cookie', 'Cadran festonné'],
    ['digital', 'Numérique'],
];

const BAR_STYLES = [
    ['islands', 'Îlots', 'Zones encastrées, séparées les unes des autres'],
    ['hug', 'Continue', 'La barre est une surface pleine'],
    ['float', 'Flottante', 'Zones détachées sur le fond d\'écran'],
    ['m3', 'Material 3', 'Seuls les boutons portent une pilule'],
];

const MODES = [
    ['', 'Suivre le réglage GNOME'],
    ['light', 'Clair'],
    ['dark', 'Sombre'],
];

/* Les mêmes que `wallset --scheme`. « auto » déduit le schéma de l'image. */
const SCHEMES = [
    ['auto', 'Automatique'],
    ['scheme-tonal-spot', 'Tonal spot'],
    ['scheme-content', 'Content'],
    ['scheme-expressive', 'Expressive'],
    ['scheme-fidelity', 'Fidelity'],
    ['scheme-fruit-salad', 'Fruit salad'],
    ['scheme-monochrome', 'Monochrome'],
    ['scheme-neutral', 'Neutral'],
    ['scheme-rainbow', 'Rainbow'],
    ['scheme-vibrant', 'Vibrant'],
];

/* Les commandes sont liées dans ~/.local/bin par install.sh, mais ce dossier
 * n'est pas toujours dans le PATH du processus de préférences : on cherche
 * explicitement avant de se rabattre sur le PATH. */
function findCommand(name) {
    const home = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', name]);
    if (GLib.file_test(home, GLib.FileTest.IS_EXECUTABLE))
        return home;
    return GLib.find_program_in_path(name);
}

function run(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE
            | Gio.SubprocessFlags.STDERR_SILENCE);
        return true;
    } catch (e) {
        logError(e, `material-you-gnome: ${argv[0]}`);
        return false;
    }
}

export default class MaterialYouBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(this._wallpaperPage());
        window.add(this._desktopPage(settings));
        window.add(this._barPage(settings));
        window.add(systemPage());
        window.add(this._aboutPage());
    }

    /* --- Fond d'écran et couleurs ------------------------------------------- */

    /* Équivalent de leur section « Wallpaper & Colors ». Rien n'est stocké ici :
     * chaque contrôle lance `wallset`, qui reste la seule autorité sur la
     * palette. Les afficher en GSettings créerait un état parallèle capable de
     * diverger de ce qui est réellement appliqué. */
    _wallpaperPage() {
        const page = new Adw.PreferencesPage({
            title: 'Fond d\'écran',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });

        const picker = new Adw.PreferencesGroup();
        const row = new Adw.ActionRow({
            title: 'Choisir un fond d\'écran',
            subtitle: 'Images locales ou recherche en ligne — pose l\'image et recolore tout',
            activatable: true,
        });
        row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));

        const wallpicker = findCommand('wallpicker');
        if (wallpicker) {
            row.connect('activated', () => run([wallpicker]));
        } else {
            row.sensitive = false;
            row.subtitle = 'wallpicker introuvable — relance ./install.sh';
        }
        picker.add(row);
        page.add(picker);

        const wallset = findCommand('wallset');
        const colors = new Adw.PreferencesGroup({
            title: 'Couleurs',
            description: wallset
                ? 'Régénère la palette depuis le fond d\'écran courant.'
                : 'wallset introuvable — relance ./install.sh',
        });

        const mode = new Adw.ComboRow({
            title: 'Mode',
            model: Gtk.StringList.new(MODES.map(([, label]) => label)),
            sensitive: Boolean(wallset),
        });
        const scheme = new Adw.ComboRow({
            title: 'Schéma',
            subtitle: 'Comment la palette est dérivée de l\'image',
            model: Gtk.StringList.new(SCHEMES.map(([, label]) => label)),
            sensitive: Boolean(wallset),
        });

        // Adw.ButtonRow n'existe qu'à partir de libadwaita 1.6 ; Ubuntu 24.04
        // en est restée en deçà. Motif classique : une ActionRow avec un bouton
        // en suffixe.
        const apply = new Adw.ActionRow({title: 'Appliquer'});
        apply.sensitive = Boolean(wallset);
        const applyButton = new Gtk.Button({
            label: 'Appliquer',
            valign: Gtk.Align.CENTER,
        });
        applyButton.add_css_class('suggested-action');
        apply.add_suffix(applyButton);
        apply.activatable_widget = applyButton;

        applyButton.connect('clicked', () => {
            const argv = [wallset];
            const m = MODES[mode.selected][0];
            if (m)
                argv.push('--mode', m);
            argv.push('--scheme', SCHEMES[scheme.selected][0]);
            run(argv);
        });

        colors.add(mode);
        colors.add(scheme);
        colors.add(apply);
        page.add(colors);

        return page;
    }

    /* --- Bureau ------------------------------------------------------------- */

    _desktopPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Bureau',
            icon_name: 'video-display-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Widgets',
            description: 'Les widgets masqués ne réservent pas de place : la pile se resserre.',
        });
        for (const [key, title, subtitle] of WIDGETS) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }
        page.add(group);

        const clock = new Adw.PreferencesGroup({title: 'Horloge'});
        const style = new Adw.ComboRow({
            title: 'Style',
            model: Gtk.StringList.new(CLOCK_STYLES.map(([, label]) => label)),
        });
        // ComboRow travaille par index : on traduit dans les deux sens plutôt
        // que de stocker un entier, pour que la clé reste lisible en dconf.
        const keys = CLOCK_STYLES.map(([key]) => key);
        style.selected = Math.max(0, keys.indexOf(settings.get_string('clock-style')));
        style.connect('notify::selected', () => {
            settings.set_string('clock-style', keys[style.selected]);
        });
        clock.add(style);
        page.add(clock);

        const zones = new Adw.PreferencesGroup({
            title: 'Fuseaux horaires',
            description: 'Un par ligne, au format <tt>Libellé|Zone</tt> — '
                + 'par exemple <tt>Tokyo|Asia/Tokyo</tt>.',
        });
        const zonesRow = new Adw.EntryRow({title: 'Fuseaux'});
        zonesRow.text = settings.get_strv('world-clocks').join(', ');
        zonesRow.connect('apply', () => {
            const list = zonesRow.text.split(',')
                .map(entry => entry.trim())
                .filter(entry => entry.includes('|'));
            settings.set_strv('world-clocks', list);
        });
        zonesRow.show_apply_button = true;
        zones.add(zonesRow);
        page.add(zones);

        const media = new Adw.PreferencesGroup({title: 'Média'});
        const lyrics = new Adw.SwitchRow({
            title: 'Paroles synchronisées',
            subtitle: 'Interroge lrclib.net à chaque changement de piste',
        });
        settings.bind('show-lyrics', lyrics, 'active', Gio.SettingsBindFlags.DEFAULT);
        media.add(lyrics);
        page.add(media);

        const quote = new Adw.PreferencesGroup({
            title: 'Citation',
            description: 'La bulle disparaît si le texte est vide.',
        });
        const quoteRow = new Adw.EntryRow({title: 'Texte'});
        settings.bind('quote-text', quoteRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        quote.add(quoteRow);
        page.add(quote);

        const layout = new Adw.PreferencesGroup({title: 'Disposition'});
        const margin = new Adw.SpinRow({
            title: 'Marge aux bords',
            subtitle: 'En pixels',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 200, step_increment: 4, page_increment: 16,
            }),
        });
        settings.bind('desktop-margin', margin, 'value', Gio.SettingsBindFlags.DEFAULT);
        layout.add(margin);
        page.add(layout);

        return page;
    }

    /* --- Barre -------------------------------------------------------------- */

    _barPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Barre',
            icon_name: 'view-continuous-symbolic',
        });

        const group = new Adw.PreferencesGroup({title: 'Apparence'});

        const style = new Adw.ComboRow({
            title: 'Forme',
            model: Gtk.StringList.new(BAR_STYLES.map(([, label]) => label)),
        });
        const styleKeys = BAR_STYLES.map(([key]) => key);
        const syncSubtitle = () => {
            style.subtitle = BAR_STYLES[style.selected][2];
        };
        style.selected = Math.max(0, styleKeys.indexOf(settings.get_string('bar-style')));
        syncSubtitle();
        style.connect('notify::selected', () => {
            settings.set_string('bar-style', styleKeys[style.selected]);
            syncSubtitle();
        });
        group.add(style);

        const floating = new Adw.SwitchRow({
            title: 'Barre flottante',
            subtitle: 'Fond transparent, ne laissant que les îlots. '
                + 'Le contenu des fenêtres maximisées transparaît alors sous la barre.',
        });
        settings.bind('floating-panel', floating, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(floating);
        page.add(group);

        return page;
    }

    /* --- À propos ----------------------------------------------------------- */

    _aboutPage() {
        const page = new Adw.PreferencesPage({
            title: 'À propos',
            icon_name: 'help-about-symbolic',
        });

        const group = new Adw.PreferencesGroup();
        group.add(new Adw.ActionRow({
            title: 'material-you-gnome',
            subtitle: 'Couche 2 de material-you-gnome — portage de l\'esprit '
                + 'd\'illogical-impulse vers GNOME Shell.',
        }));
        group.add(new Adw.ActionRow({
            title: 'Palette',
            subtitle: 'Générée par matugen depuis le fond d\'écran, à chaque `wallset`.',
        }));
        page.add(group);

        return page;
    }
}
