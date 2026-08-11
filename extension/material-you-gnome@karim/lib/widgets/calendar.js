/* Carte calendrier du bureau.
 *
 * Reprend widgets/calendar/CalendarWidget.qml : le mois courant en grille, le
 * jour du jour mis en avant. Purement local — aucune source de données, juste
 * l'horloge système.
 *
 * Le premier jour de la semaine vient de la locale via Shell.util_get_week_start()
 * plutôt que d'être fixé à lundi : c'est ce qu'utilise le calendrier de GNOME,
 * donc les deux restent cohérents.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

const COLUMNS = 7;
const REFRESH_SECONDS = 1800;   // le mois ne change pas plus vite qu'une demi-heure

export const CalendarCard = GObject.registerClass(
class CalendarCard extends St.BoxLayout {
    _init() {
        super._init({
            vertical: true,
            style_class: 'myg-card myg-calendar',
            reactive: true,   // sinon les flèches ne reçoivent pas les clics
        });

        // En-tête navigable, comme la référence : ‹ mois ›. Le décalage est un
        // simple compteur de mois relatif au mois courant.
        this._offset = 0;

        const header = new St.BoxLayout({style_class: 'myg-cal-headerbox'});
        header.add_child(this._navButton('go-previous-symbolic', -1));

        this._header = new St.Label({
            style_class: 'myg-cal-header',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._header);

        header.add_child(this._navButton('go-next-symbolic', 1));
        this.add_child(header);

        // Centrée : la grille (7 × 44 px) est plus étroite que la carte, dont
        // la largeur est imposée par la carte média au-dessus. Alignée à
        // gauche, elle laissait un vide franc sur le bord droit.
        this._grid = new St.Widget({
            layout_manager: new Clutter.GridLayout(),
            style_class: 'myg-cal-grid',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._grid);

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                // Ne pas redessiner si l'utilisateur consulte un autre mois :
                // il serait ramené au mois courant sans l'avoir demandé.
                if (this._offset === 0)
                    this._build();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => this._onDestroy());
        this._build();
    }

    get anchor() {
        return 'top-left';
    }

    _navButton(iconName, delta) {
        const button = new St.Button({
            style_class: 'myg-cal-nav',
            child: new St.Icon({icon_name: iconName, icon_size: 14}),
            can_focus: true,
        });
        button.connect('clicked', () => {
            this._offset += delta;
            this._build();
        });
        return button;
    }

    /* Shell renvoie 0 pour dimanche ; on travaille en 1..7 (lundi..dimanche)
     * comme GLib.DateTime.get_day_of_week(). */
    _weekStart() {
        try {
            const ws = Shell.util_get_week_start();
            return ws === 0 ? 7 : ws;
        } catch (e) {
            return 1;
        }
    }

    _build() {
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;

        const now = GLib.DateTime.new_now_local();
        const shown = this._offset === 0 ? now : now.add_months(this._offset);
        const year = shown.get_year();
        const month = shown.get_month();

        // « Aujourd'hui » ne se surligne que dans le mois réel.
        const today = (year === now.get_year() && month === now.get_month())
            ? now.get_day_of_month()
            : -1;

        this._header.text = shown.format('%B %Y');

        const weekStart = this._weekStart();

        // En-tête des jours : on prend une semaine de référence dont on sait
        // que le 1ᵉʳ janvier 2024 était un lundi, plutôt que de coder les noms.
        for (let i = 0; i < COLUMNS; i++) {
            const dow = ((weekStart - 1 + i) % 7) + 1;
            const sample = GLib.DateTime.new_local(2024, 1, dow, 12, 0, 0);
            const label = new St.Label({
                text: sample.format('%a').slice(0, 2),
                style_class: 'myg-cal-dow',
            });
            layout.attach(label, i, 0, 1, 1);
        }

        const first = GLib.DateTime.new_local(year, month, 1, 12, 0, 0);
        const daysInMonth = first.add_months(1).add_days(-1).get_day_of_month();
        const offset = (first.get_day_of_week() - weekStart + 7) % 7;

        for (let day = 1; day <= daysInMonth; day++) {
            const index = offset + day - 1;
            const cell = new St.Label({
                text: String(day),
                style_class: day === today ? 'myg-cal-day today' : 'myg-cal-day',
            });
            layout.attach(cell, index % COLUMNS, Math.floor(index / COLUMNS) + 1, 1, 1);
        }
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
