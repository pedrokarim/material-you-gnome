#!/usr/bin/env bash
# Construit un thème GNOME Shell dérivé de Yaru, recoloré Material You.
#
# Yaru compile son SCSS : gnome-shell.css contient ~5000 lignes de hex en dur,
# aucune variable. On ne peut donc pas injecter de couleurs par substitution.
# À la place : on copie le thème complet (assets SVG inclus, sinon les icônes
# cassent) et on append un bloc d'overrides. La cascade CSS fait le reste.
#
# St (le moteur CSS du Shell) ne supporte pas var() — tous les hex sont inlinés.

set -euo pipefail

COLORS="${XDG_CACHE_HOME:-$HOME/.cache}/material-you-gnome/colors.sh"
THEME_DIR="$HOME/.local/share/themes/MaterialYou/gnome-shell"

[ -f "$COLORS" ] || { echo "build-shell-theme: $COLORS absent — lance matugen d'abord" >&2; exit 1; }
# shellcheck source=/dev/null
source "$COLORS"

# Yaru-dark quand le système est en sombre, Yaru sinon : on part de la base la
# plus proche pour que les assets non recolorables (SVG) restent cohérents.
if [ "${MY_MODE:-dark}" = "dark" ]; then SRC=/usr/share/themes/Yaru-dark/gnome-shell
else SRC=/usr/share/themes/Yaru/gnome-shell; fi
[ -d "$SRC" ] || SRC=/usr/share/themes/Yaru/gnome-shell

rm -rf "$THEME_DIR"
mkdir -p "$THEME_DIR"
cp -r "$SRC"/. "$THEME_DIR"/

cat >> "$THEME_DIR/gnome-shell.css" <<CSS

/* ==========================================================================
   Material You overrides — généré par material-you-gnome, NE PAS ÉDITER.
   Régénéré à chaque changement de fond d'écran via \`wallset\`.
   ========================================================================== */

/* --- Barre supérieure --- */
#panel {
  background-color: ${MY_SURFACE_CONTAINER};
  color: ${MY_ON_SURFACE};
}
#panel:overview { background-color: transparent; }
#panel .panel-button { color: ${MY_ON_SURFACE}; }
#panel .panel-button:hover,
#panel .panel-button:focus,
#panel .panel-button:active,
#panel .panel-button:checked {
  background-color: ${MY_SECONDARY_CONTAINER};
  color: ${MY_ON_SECONDARY_CONTAINER};
}
#panel .panel-button .system-status-icon { color: inherit; }

/* --- Menus déroulants / quick settings --- */
.popup-menu-content,
.quick-settings,
.candidate-popup-content {
  background-color: ${MY_SURFACE_CONTAINER_HIGH};
  color: ${MY_ON_SURFACE};
  border: 1px solid ${MY_OUTLINE_VARIANT};
}
.popup-menu-item:hover,
.popup-menu-item:focus,
.popup-menu-item.selected {
  background-color: ${MY_SECONDARY_CONTAINER};
  color: ${MY_ON_SECONDARY_CONTAINER};
}
.popup-separator-menu-item StWidget { background-color: ${MY_OUTLINE_VARIANT}; }

.quick-toggle,
.quick-menu-toggle,
.quick-slider {
  background-color: ${MY_SURFACE_CONTAINER_HIGHEST};
  color: ${MY_ON_SURFACE};
}
.quick-toggle:checked,
.quick-menu-toggle:checked,
.quick-toggle.button:checked {
  background-color: ${MY_PRIMARY};
  color: ${MY_ON_PRIMARY};
}
.quick-settings .icon-button,
.quick-settings-system-item .icon-button {
  background-color: ${MY_SURFACE_CONTAINER_HIGHEST};
  color: ${MY_ON_SURFACE};
}

/* --- Sliders (volume, luminosité) --- */
.slider { color: ${MY_PRIMARY}; -barlevel-background-color: ${MY_SURFACE_CONTAINER_HIGHEST}; -barlevel-active-background-color: ${MY_PRIMARY}; }

/* --- Notifications --- */
.message,
.message-list-section-title,
.notification-banner {
  background-color: ${MY_SURFACE_CONTAINER_HIGH};
  color: ${MY_ON_SURFACE};
}
.message:hover, .message:focus { background-color: ${MY_SURFACE_CONTAINER_HIGHEST}; }

/* --- Calendrier --- */
.calendar,
.datemenu-today-button,
.world-clocks-button,
.weather-button,
.events-button {
  background-color: ${MY_SURFACE_CONTAINER_HIGH};
  color: ${MY_ON_SURFACE};
}
.calendar-today,
.calendar-day-with-events {
  color: ${MY_PRIMARY};
}
.calendar .calendar-day-base:hover { background-color: ${MY_SECONDARY_CONTAINER}; }
.calendar .calendar-day-base:selected {
  background-color: ${MY_PRIMARY};
  color: ${MY_ON_PRIMARY};
}

/* --- Overview / recherche --- */
.search-entry {
  background-color: ${MY_SURFACE_CONTAINER_HIGHEST};
  color: ${MY_ON_SURFACE};
  border-color: ${MY_OUTLINE_VARIANT};
}
.search-entry:focus { border-color: ${MY_PRIMARY}; }
.search-section-content { background-color: ${MY_SURFACE_CONTAINER}; }
.app-well-app .overview-icon:hover,
.search-provider-icon:hover,
.grid-search-result .overview-icon:hover {
  background-color: ${MY_SECONDARY_CONTAINER};
}
.workspace-thumbnail-indicator { border-color: ${MY_PRIMARY}; }

/* --- Dash / dock Ubuntu --- */
#dash .dash-background,
#dashtodockContainer .dash-background {
  background-color: ${MY_SURFACE_CONTAINER};
}
.dash-item-container .app-well-app .overview-icon { color: ${MY_ON_SURFACE}; }

/* --- Dialogues modaux --- */
.modal-dialog {
  background-color: ${MY_SURFACE_CONTAINER_HIGH};
  color: ${MY_ON_SURFACE};
}
.modal-dialog-linked-button {
  background-color: ${MY_SURFACE_CONTAINER_HIGHEST};
  color: ${MY_ON_SURFACE};
}
.modal-dialog-linked-button:hover { background-color: ${MY_SECONDARY_CONTAINER}; }
.modal-dialog-linked-button:default {
  background-color: ${MY_PRIMARY};
  color: ${MY_ON_PRIMARY};
}

/* --- OSD (volume/luminosité à l'écran) --- */
.osd-window {
  background-color: ${MY_SURFACE_CONTAINER_HIGH};
  color: ${MY_ON_SURFACE};
}

/* --- Sélecteur de fenêtres (Alt+Tab) --- */
.switcher-list { background-color: ${MY_SURFACE_CONTAINER_HIGH}; }
.switcher-list .item-box:selected {
  background-color: ${MY_PRIMARY};
  color: ${MY_ON_PRIMARY};
}

/* ==========================================================================
   Material 3 — géométrie.
   Recolorer ne suffit pas : ce qui distingue Material 3 de « Yaru en d'autres
   couleurs », c'est la forme. M3 définit une échelle de rayons —
   4 / 8 / 12 / 16 / 28 px, plus « full » (pilule) — et des surfaces plus
   généreusement rembourrées. C'est ce bloc qui fait le gros de l'effet.
   ========================================================================== */

/* Conteneurs de premier niveau : rayon « extra large ». */
.popup-menu-content,
.quick-settings,
.candidate-popup-content,
.modal-dialog,
.osd-window,
.switcher-list {
  border-radius: 28px;
}

.popup-menu-content,
.quick-settings {
  padding: 10px 8px;
}

/* Les entrées de menu se détachent du bord : la surbrillance M3 est une
   pilule encastrée, pas une bande pleine largeur. */
.popup-menu-item {
  border-radius: 12px;
  margin-left: 6px;
  margin-right: 6px;
  padding: 8px 12px;
}

/* Tuiles des quick settings : pilule pleine, comme sur Android 12+. */
.quick-toggle,
.quick-menu-toggle,
.quick-slider,
.quick-settings .icon-button,
.quick-settings-system-item .icon-button,
.quick-settings .button {
  border-radius: 999px;
}

/* Boutons : pilule partout. */
.button,
.modal-dialog-linked-button,
.message-list-clear-button,
.notification-banner .notification-button {
  border-radius: 999px;
}

/* Champ de recherche de l'overview. */
.search-entry {
  border-radius: 999px;
  padding: 8px 16px;
}

/* Notifications et tuiles du calendrier : rayon « large ». */
.message,
.notification-banner,
.datemenu-today-button,
.world-clocks-button,
.weather-button,
.events-button,
.message-list-section-title {
  border-radius: 20px;
}

/* Jours du calendrier : ronds. */
.calendar .calendar-day-base {
  border-radius: 999px;
}

/* Overview : icônes d'applications et vignettes. */
.app-well-app .overview-icon,
.grid-search-result .overview-icon,
.search-provider-icon,
.switcher-list .item-box {
  border-radius: 16px;
}

/* Dash / dock. */
#dash .dash-background,
#dashtodockContainer .dash-background {
  border-radius: 28px;
}

/* ==========================================================================
   Accent de marque Yaru.
   Yaru pose son orange #d34615 (et #ef8661 pour les anneaux de focus) sur une
   quarantaine de sélecteurs. Recolorer le fond des conteneurs ne suffit donc
   pas : cet orange ressort partout où l'on interagit — chevron des quick
   settings, jour courant, boutons par défaut, anneaux de focus.
   La liste vient d'une extraction de tous les blocs du CSS Yaru contenant ces
   deux teintes, pas d'un repérage à l'œil.
   ========================================================================== */

/* Surfaces remplies à l'accent (background-color chez Yaru). */
.quick-toggle:checked,
.quick-menu-toggle .quick-toggle-arrow:checked,
.quick-toggle-menu .header .icon.active,
.calendar .calendar-day.calendar-today,
.calendar .calendar-month-header .default.pager-button,
.button.default,
.icon-button.default,
.default.screenshot-ui-show-pointer-button,
.message .message-header .default.message-expand-button,
.message .message-header .default.message-close-button,
.keyboard-brightness-level .button:checked,
.candidate-box:selected,
.emoji-panel .keyboard-key:latched,
.keyboard-key.default-key:latched,
.login-dialog-auth-list-item:selected {
  background-color: ${MY_PRIMARY};
  color: ${MY_ON_PRIMARY};
}

.quick-toggle:hover:checked,
.quick-menu-toggle .quick-toggle-arrow:hover:checked,
.calendar .calendar-day.calendar-today:hover,
.button.default:hover,
.icon-button.default:hover {
  background-color: ${MY_PRIMARY_CONTAINER};
  color: ${MY_ON_PRIMARY_CONTAINER};
}

/* Anneaux de focus. Yaru les pose en box-shadow avec !important : il faut donc
   la même arme pour reprendre la main. */
StEntry:focus,
.search-entry:focus,
.button:focus,
.icon-button:focus,
.modal-dialog-linked-button:focus,
.quick-toggle:focus,
.quick-slider:focus,
.quick-menu-toggle .quick-toggle-arrow:focus,
.popup-menu-item:focus,
.message:focus,
.calendar .calendar-day-base:focus,
.app-well-app .overview-icon:focus,
.grid-search-result .overview-icon:focus {
  box-shadow: inset 0 0 0 2px ${MY_PRIMARY} !important;
}

/* Sélection de texte et bordures d'accent. */
StEntry {
  selection-background-color: ${MY_PRIMARY_CONTAINER};
  selected-color: ${MY_ON_PRIMARY_CONTAINER};
}

/* Indicateurs : point d'application ouverte, aperçu de tuilage, surbrillance
   de l'Alt+Tab, sélection de fenêtre pour la capture. */
#dash .dash-item-container .app-grid-running-dot,
#dashtodockContainer.bottom .dash-item-container .app-grid-running-dot,
#dashtodockContainer.left .dash-item-container .app-grid-running-dot,
#dashtodockContainer.right .dash-item-container .app-grid-running-dot,
#dashtodockContainer.top .dash-item-container .app-grid-running-dot,
.cycler-highlight,
.osd-monitor-label,
.screenshot-ui-window-selector-window:checked .screenshot-ui-window-selector-check {
  background-color: ${MY_PRIMARY};
  color: ${MY_ON_PRIMARY};
}

.tile-preview,
.magnifier-zoom-region,
.screenshot-ui-window-selector-window:checked .screenshot-ui-window-selector-window-border {
  border-color: ${MY_PRIMARY};
}
CSS

# index.theme : requis pour que user-theme liste le thème
cat > "$HOME/.local/share/themes/MaterialYou/index.theme" <<EOF
[Desktop Entry]
Type=X-GNOME-Metatheme
Name=MaterialYou
Comment=Généré depuis le fond d'écran par material-you-gnome
Encoding=UTF-8

[X-GNOME-Metatheme]
GtkTheme=Yaru
MetacityTheme=Yaru
IconTheme=Yaru
EOF

echo "build-shell-theme: thème écrit dans $THEME_DIR (base: $SRC)"
