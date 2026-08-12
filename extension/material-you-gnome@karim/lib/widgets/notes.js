/* Bloc-notes du bureau.
 *
 * Reprend widgets/notes/NotesWidget.qml. Le texte vit dans GSettings plutôt que
 * dans un fichier : il est ainsi éditable depuis le panneau de réglages comme
 * depuis le widget, sans deux sources qui divergent.
 *
 * L'édition sur place dépend du clavier, qui n'atteint la couche bureau que si
 * rien ne la recouvre — voir la limite documentée dans lib/desktop.js. Le champ
 * reste donc doublé par le réglage, qui fonctionne toujours.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// On n'écrit pas à chaque frappe : GSettings déclenche un signal par écriture,
// et le widget se recharge en boucle.
const SAVE_DELAY_MS = 600;

/* `edit_note` de Material Symbols Rounded, relevé dans la cmap de la police.
 * Le jeu d'icônes du thème n'a pas d'équivalent : `note-symbolic` n'existe pas
 * chez Yaru, et St affiche alors la vignette « image manquante ». */
const NOTES_GLYPH = '\uE745';

export const Notes = GObject.registerClass(
class Notes extends St.BoxLayout {
    _init(extension) {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-notes',
            reactive: true,
        });

        this._settings = extension.getSettings();
        this._saveId = 0;

        const header = new St.BoxLayout({style_class: 'myg-notes-header'});
        header.add_child(new St.Label({
            text: NOTES_GLYPH,
            style_class: 'myg-notes-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            text: 'Notes',
            style_class: 'myg-notes-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.add_child(header);

        this._entry = new St.Entry({
            style_class: 'myg-notes-entry',
            hint_text: 'Écris ici…',
            can_focus: true,
            x_expand: true,
        });
        this._entry.clutter_text.set_single_line_mode(false);
        this._entry.clutter_text.set_line_wrap(true);
        this._entry.clutter_text.set_activatable(false);
        this.add_child(this._entry);

        this._entry.clutter_text.connect('text-changed', () => this._queueSave());

        this._settingsId = this._settings.connect(
            'changed::notes-text', () => this._load());

        this.connect('destroy', () => this._onDestroy());
        this._load();
    }

    get anchor() {
        return 'top-left';
    }

    _load() {
        const text = this._settings.get_string('notes-text');
        if (this._entry.get_text() !== text)
            this._entry.set_text(text);
    }

    /* Écriture différée : sans ça, chaque frappe écrit dans GSettings, qui émet
     * un `changed` en retour et repose le texte — le curseur saute. */
    _queueSave() {
        if (this._saveId)
            GLib.Source.remove(this._saveId);

        this._saveId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
                this._saveId = 0;
                const text = this._entry.get_text();
                if (this._settings.get_string('notes-text') !== text)
                    this._settings.set_string('notes-text', text);
                return GLib.SOURCE_REMOVE;
            });
    }

    _onDestroy() {
        if (this._saveId) {
            GLib.Source.remove(this._saveId);
            this._saveId = 0;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
    }
});
