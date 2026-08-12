/* Minuteur pomodoro.
 *
 * Reprend widgets/pomodoro/ de leur sidebar droite. Aucune dépendance : c'est
 * un compte à rebours et deux durées.
 *
 * Le décompte se relit sur l'horloge monotone à chaque tick plutôt que de
 * décrémenter un compteur : une seconde de timer GLib n'en vaut pas exactement
 * une, et l'écart s'accumulerait sur vingt-cinq minutes.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const WORK = 'work';
const BREAK = 'break';

export const Pomodoro = GObject.registerClass(
class Pomodoro extends St.BoxLayout {
    _init(extension) {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-pomodoro',
            reactive: true,
        });

        this._settings = extension.getSettings();

        this._phase = WORK;
        this._running = false;
        // Instant de fin sur l'horloge monotone — pas sur l'heure murale, qui
        // recule à chaque synchronisation NTP ou changement d'heure.
        this._endsAt = 0;
        this._remaining = this._duration(WORK);

        const header = new St.BoxLayout({style_class: 'myg-pomodoro-header'});
        this._phaseLabel = new St.Label({
            text: 'Travail',
            style_class: 'myg-pomodoro-phase',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._phaseLabel);
        this._cycles = new St.Label({
            text: '',
            style_class: 'myg-pomodoro-cycles',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._cycles);
        this.add_child(header);

        this._time = new St.Label({
            style_class: 'myg-pomodoro-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._time);

        const controls = new St.BoxLayout({
            style_class: 'myg-pomodoro-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._toggle = this._button('media-playback-start-symbolic',
            () => this._toggleRun());
        controls.add_child(this._toggle);
        controls.add_child(this._button('view-refresh-symbolic',
            () => this._reset()));
        controls.add_child(this._button('media-skip-forward-symbolic',
            () => this._nextPhase(true)));
        this.add_child(controls);

        this._completed = 0;

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 1, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });

        this._settingsIds = ['pomodoro-work', 'pomodoro-break'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._reset()));

        this.connect('destroy', () => this._onDestroy());
        this._render();
    }

    get anchor() {
        return 'top-left';
    }

    _button(iconName, onClick) {
        const button = new St.Button({
            style_class: 'myg-pomodoro-button',
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
            can_focus: true,
            track_hover: true,
        });
        button.connect('clicked', onClick);
        return button;
    }

    _duration(phase) {
        const key = phase === WORK ? 'pomodoro-work' : 'pomodoro-break';
        return this._settings.get_int(key) * 60;
    }

    /* --- Décompte ----------------------------------------------------------- */

    _toggleRun() {
        if (this._running) {
            this._remaining = Math.max(0, this._endsAt - this._now());
            this._running = false;
        } else {
            this._endsAt = this._now() + this._remaining;
            this._running = true;
        }
        this._render();
    }

    _reset() {
        this._running = false;
        this._remaining = this._duration(this._phase);
        this._render();
    }

    /* `manual` distingue le saut demandé par l'utilisateur de la fin naturelle :
     * seule la seconde compte un cycle et prévient. */
    _nextPhase(manual) {
        if (!manual && this._phase === WORK)
            this._completed++;

        this._phase = this._phase === WORK ? BREAK : WORK;
        this._remaining = this._duration(this._phase);
        this._endsAt = this._now() + this._remaining;

        if (!manual)
            this._notify();

        this._render();
    }

    _now() {
        return GLib.get_monotonic_time() / 1e6;
    }

    _tick() {
        if (!this._running)
            return;

        const left = this._endsAt - this._now();
        if (left <= 0) {
            this._nextPhase(false);
            return;
        }

        this._remaining = left;
        this._render();
    }

    _notify() {
        const message = this._phase === BREAK
            ? 'Pause méritée.'
            : 'Retour au travail.';
        try {
            Main.notify('Pomodoro', message);
        } catch (e) {
            logError(e, 'material-you-gnome: notification pomodoro');
        }
    }

    /* --- Affichage ---------------------------------------------------------- */

    _render() {
        const total = Math.max(0, Math.round(this._remaining));
        const minutes = String(Math.floor(total / 60)).padStart(2, '0');
        const seconds = String(total % 60).padStart(2, '0');

        this._time.text = `${minutes}:${seconds}`;
        this._phaseLabel.text = this._phase === WORK ? 'Travail' : 'Pause';
        this._cycles.text = this._completed ? `${this._completed} ✓` : '';

        this._toggle.child.icon_name = this._running
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        if (this._phase === BREAK)
            this._time.add_style_class_name('break');
        else
            this._time.remove_style_class_name('break');
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];
    }
});
