/* Horloge festonnée — l'élément signature de la capture n°1 d'end4-pC.
 *
 * Reprend widgets/clock/CookieClock.qml : un disque à bord ondulé, des chiffres
 * aux quarts, deux aiguilles arrondies, une bulle de date. QML dessine ça avec
 * un Shape ; ici c'est du Cairo dans une St.DrawingArea, seul moyen d'obtenir
 * une forme non rectangulaire sous St.
 *
 * Les couleurs ne sont pas codées ici : elles sont lues sur le nœud de thème
 * via des propriétés CSS maison (-myg-*), donc elles suivent la palette générée
 * par matugen comme le reste. St.ThemeNode.lookup_color accepte n'importe quel
 * nom de propriété, ce qui évite de reparser colors.sh côté JS.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Cairo from 'gi://cairo';

const SIZE = 280;          // côté de la zone de dessin

const LOBES = 12;          // nombre d'ondulations du bord
const AMPLITUDE = 0.055;   // profondeur des ondulations, en fraction du rayon

// L'aiguille des secondes impose la seconde. Un repaint Cairo de 280×280 est
// négligeable, et glib aligne le timeout sur la seconde entière.
const TICK_SECONDS = 1;

function useColor(cr, color) {
    cr.setSourceRGBA(
        color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
}

export const CookieClock = GObject.registerClass(
class CookieClock extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'myg-clock',
            width: SIZE,
            height: SIZE,
            reactive: false,
        });

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });

        // La feuille de style est rechargée à chaque `wallset` : il faut
        // redessiner, sinon l'horloge garde les couleurs de l'ancien wallpaper.
        this.connect('style-changed', () => this.queue_repaint());
        this.connect('repaint', () => this._draw());
        this.connect('destroy', () => this._onDestroy());
    }

    // Placée par lib/desktop.js ; on ne déclare que le coin voulu.
    get anchor() {
        return 'top-left';
    }

    /* --- Couleurs ---------------------------------------------------------- */

    _color(name, fallbackName) {
        const node = this.get_theme_node();
        const [found, color] = node.lookup_color(name, false);
        if (found)
            return color;
        if (fallbackName)
            return this._color(fallbackName);
        return node.get_foreground_color();
    }

    /* --- Dessin ------------------------------------------------------------ */

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const cx = w / 2;
        const cy = h / 2;
        // La marge doit absorber deux choses : les lobes, qui débordent du
        // rayon nominal de AMPLITUDE, et le décalage de l'ombre vers le bas.
        const radius = Math.min(w, h) / 2 - 14;

        const face = this._color('-myg-clock-face');
        const ink = this._color('-myg-clock-ink');
        const hand = this._color('-myg-clock-hand');
        const accent = this._color('-myg-clock-accent');
        const chip = this._color('-myg-clock-chip');
        const chipInk = this._color('-myg-clock-chip-ink');

        this._drawShadow(cr, cx, cy, radius);
        this._drawScallopedFace(cr, cx, cy, radius, face);
        this._drawHourNumbers(cr, cx, cy, radius, ink);
        this._drawHands(cr, cx, cy, radius, hand, accent);
        this._drawDateBubble(cr, cx, cy, radius, accent, face);
        this._drawMonthChip(cr, cx, cy, radius, chip, chipInk);

        cr.$dispose();
    }


    /* Ombre portée : la même silhouette, décalée et noire translucide, empilée
     * en trois passes décroissantes. Un vrai flou gaussien serait recalculé à
     * chaque seconde à cause de la trotteuse ; trois remplissages coûtent
     * quelques microsecondes et suffisent à décoller le cadran du fond. */
    _drawShadow(cr, cx, cy, radius) {
        for (const [offset, alpha] of [[6, 0.10], [4, 0.10], [2, 0.10]]) {
            cr.setSourceRGBA(0, 0, 0, alpha);
            this._scallopedPath(cr, cx, cy + offset, radius);
            cr.fill();
        }
    }

    _scallopedPath(cr, cx, cy, radius) {
        const steps = 360;
        cr.newPath();
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * 2 * Math.PI;
            const r = radius * (1 + AMPLITUDE * Math.cos(LOBES * t));
            const x = cx + r * Math.cos(t);
            const y = cy + r * Math.sin(t);
            if (i === 0)
                cr.moveTo(x, y);
            else
                cr.lineTo(x, y);
        }
        cr.closePath();
    }

    _drawScallopedFace(cr, cx, cy, radius, color) {
        // r(θ) = R · (1 + a·cos(nθ)) : un cercle dont le rayon ondule n fois.
        this._scallopedPath(cr, cx, cy, radius);
        useColor(cr, color);
        cr.fill();
    }

    _drawHourNumbers(cr, cx, cy, radius, color) {
        // Filigrane, pas texte de premier plan : sur la référence les chiffres
        // sont à peine plus clairs que la face, ce sont les aiguilles qui
        // portent la lecture. C'est leur variante « BigHourNumbers » de
        // MinuteMarks — d'où l'absence totale de graduations sur le cadran.
        cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, 0.28);
        cr.selectFontFace('Readex Pro', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(radius * 0.42);

        const marks = [['12', -Math.PI / 2], ['3', 0], ['6', Math.PI / 2], ['9', Math.PI]];
        const ring = radius * 0.62;

        for (const [text, angle] of marks) {
            const ext = cr.textExtents(text);
            const x = cx + ring * Math.cos(angle) - (ext.width / 2 + ext.xBearing);
            const y = cy + ring * Math.sin(angle) + ext.height / 2;
            cr.moveTo(x, y);
            cr.showText(text);
        }
        cr.newPath();   // showText laisse la position courante dans le chemin
    }

    _drawHands(cr, cx, cy, radius, handColor, accentColor) {
        const now = GLib.DateTime.new_now_local();
        const hours = now.get_hour() % 12;
        const minutes = now.get_minute();
        const seconds = now.get_second();

        // -π/2 pour que zéro pointe vers midi plutôt que vers 3 h.
        const hourAngle = ((hours + minutes / 60) / 12) * 2 * Math.PI - Math.PI / 2;
        const minuteAngle = ((minutes + seconds / 60) / 60) * 2 * Math.PI - Math.PI / 2;
        const secondAngle = (seconds / 60) * 2 * Math.PI - Math.PI / 2;

        cr.setLineCap(Cairo.LineCap.ROUND);

        useColor(cr, handColor);
        cr.setLineWidth(radius * 0.085);
        cr.moveTo(cx, cy);
        cr.lineTo(cx + radius * 0.42 * Math.cos(hourAngle),
                  cy + radius * 0.42 * Math.sin(hourAngle));
        cr.stroke();

        cr.setLineWidth(radius * 0.06);
        cr.moveTo(cx, cy);
        cr.lineTo(cx + radius * 0.66 * Math.cos(minuteAngle),
                  cy + radius * 0.66 * Math.sin(minuteAngle));
        cr.stroke();

        // Secondes : un point qui orbite, pas une aiguille. C'est le parti pris
        // de CookieClock — sur la capture de référence à 14 h 54, la trotteuse
        // est un disque isolé près du 6, sans tige jusqu'au centre.
        useColor(cr, accentColor);
        cr.arc(cx + radius * 0.72 * Math.cos(secondAngle),
               cy + radius * 0.72 * Math.sin(secondAngle),
               radius * 0.055, 0, 2 * Math.PI);
        cr.fill();

        cr.arc(cx, cy, radius * 0.05, 0, 2 * Math.PI);
        cr.fill();
    }

    /* Cercle du mois, en bas à droite — le pendant de la bulle du jour en haut
     * à gauche. Sur la capture de référence : « 12 » et « 07 », deux ronds
     * diamétralement opposés, à cheval sur le bord du cadran. */
    _drawMonthChip(cr, cx, cy, radius, bgColor, textColor) {
        const month = GLib.DateTime.new_now_local().format('%m');

        const bx = cx + radius * 0.72;
        const by = cy + radius * 0.72;
        const r = radius * 0.2;

        useColor(cr, bgColor);
        cr.arc(bx, by, r, 0, 2 * Math.PI);
        cr.fill();

        useColor(cr, textColor);
        cr.selectFontFace('Readex Pro', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(r * 0.85);
        const ext = cr.textExtents(month);
        cr.moveTo(bx - (ext.width / 2 + ext.xBearing), by + ext.height / 2);
        cr.showText(month);
        cr.newPath();
    }

    _drawDateBubble(cr, cx, cy, radius, bubbleColor, textColor) {
        const day = String(GLib.DateTime.new_now_local().get_day_of_month());

        // Posée sur le bord haut-gauche, à cheval sur le disque.
        const bx = cx - radius * 0.72;
        const by = cy - radius * 0.72;
        const r = radius * 0.2;

        useColor(cr, bubbleColor);
        cr.arc(bx, by, r, 0, 2 * Math.PI);
        cr.fill();

        useColor(cr, textColor);
        cr.selectFontFace('Readex Pro', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(r * 0.95);
        const ext = cr.textExtents(day);
        cr.moveTo(bx - (ext.width / 2 + ext.xBearing), by + ext.height / 2);
        cr.showText(day);
        cr.newPath();
    }

    _onDestroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
});
