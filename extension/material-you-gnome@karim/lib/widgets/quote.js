/* Bulle de citation, sous l'horloge.
 *
 * Reprend widgets/clock/CookieQuote.qml : une pastille arrondie, précédée de
 * l'icône `format_quote` de Material Symbols. Chez eux le texte vient d'une clé
 * de configuration (`background.widgets.clock.quote.text`) — ce n'est pas un
 * recueil de citations qui tourne, juste une phrase que l'utilisateur choisit.
 *
 * Ici : la clé GSettings `quote-text`, éditable dans le panneau de réglages.
 * Texte vide, la bulle disparaît — un cadre vide sur le bureau serait pire que
 * rien.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

/* Codepoint relevé dans la cmap de MaterialSymbolsRounded.ttf plutôt que la
 * ligature « format_quote » : la police a bien une table GSUB, mais un
 * codepoint ne peut pas dégénérer en texte brut si la police manque — on aura
 * un glyphe manquant, pas le mot écrit en clair. */
const QUOTE_GLYPH = '\uE244';

export const QuoteBubble = GObject.registerClass(
class QuoteBubble extends St.BoxLayout {
    _init(extension) {
        super._init({
            style_class: 'myg-quote',
            reactive: false,
        });

        this._icon = new St.Label({
            text: QUOTE_GLYPH,
            style_class: 'myg-quote-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._text = new St.Label({
            style_class: 'myg-quote-text',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(this._icon);
        this.add_child(this._text);

        this.visible = false;

        this._settings = extension.getSettings();
        this._settingsId = this._settings.connect(
            'changed::quote-text', () => this._sync());

        this.connect('destroy', () => this._onDestroy());
        this._sync();
    }

    get anchor() {
        return 'top-left';
    }

    _sync() {
        const text = this._read();
        const wasVisible = this.visible;

        this._text.text = text ?? '';
        this.visible = Boolean(text);

        if (this.visible !== wasVisible)
            this.notify('visible');
    }

    _read() {
        return this._settings.get_string('quote-text').trim() || null;
    }

    _onDestroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
    }
});
