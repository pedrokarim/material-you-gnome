#!/usr/bin/env bash
# Injecte les couleurs Material You dans VS Code via workbench.colorCustomizations.
#
# settings.json contient déjà des réglages perso (police, thème, extensions).
# On merge avec jq au lieu d'écraser, et on ne touche QUE la clé
# workbench.colorCustomizations. Une sauvegarde est faite au premier passage.

set -euo pipefail

COLORS="${XDG_CACHE_HOME:-$HOME/.cache}/material-you-gnome/colors.sh"
SETTINGS="$HOME/.config/Code/User/settings.json"

[ -f "$SETTINGS" ] || { echo "apply-vscode: pas de settings.json, ignoré"; exit 0; }
[ -f "$COLORS" ] || { echo "apply-vscode: $COLORS absent" >&2; exit 1; }
command -v jq >/dev/null || { echo "apply-vscode: jq requis" >&2; exit 1; }

# shellcheck source=/dev/null
source "$COLORS"

[ -f "$SETTINGS.before-material-you" ] || cp "$SETTINGS" "$SETTINGS.before-material-you"

CUSTOM=$(jq -n \
  --arg bg           "$MY_SURFACE" \
  --arg bg_alt       "$MY_SURFACE_CONTAINER" \
  --arg bg_high      "$MY_SURFACE_CONTAINER_HIGH" \
  --arg fg           "$MY_ON_SURFACE" \
  --arg primary      "$MY_PRIMARY" \
  --arg on_primary   "$MY_ON_PRIMARY" \
  --arg sec_cont     "$MY_SECONDARY_CONTAINER" \
  --arg outline      "$MY_OUTLINE_VARIANT" \
  --arg error        "$MY_ERROR" \
  '{
    "editor.background": $bg,
    "editor.foreground": $fg,
    "editorCursor.foreground": $primary,
    "editorLineNumber.activeForeground": $primary,
    "editor.lineHighlightBackground": $bg_alt,
    "editor.selectionBackground": $sec_cont,
    "sideBar.background": $bg_alt,
    "sideBar.foreground": $fg,
    "sideBarSectionHeader.background": $bg_high,
    "activityBar.background": $bg_alt,
    "activityBar.foreground": $primary,
    "activityBarBadge.background": $primary,
    "activityBarBadge.foreground": $on_primary,
    "titleBar.activeBackground": $bg_alt,
    "titleBar.activeForeground": $fg,
    "statusBar.background": $primary,
    "statusBar.foreground": $on_primary,
    "tab.activeBackground": $bg,
    "tab.inactiveBackground": $bg_alt,
    "tab.activeBorderTop": $primary,
    "editorGroupHeader.tabsBackground": $bg_alt,
    "panel.background": $bg_alt,
    "panel.border": $outline,
    "terminal.background": $bg,
    "terminal.foreground": $fg,
    "focusBorder": $primary,
    "errorForeground": $error
  }')

TMP=$(mktemp)
jq --argjson c "$CUSTOM" '.["workbench.colorCustomizations"] = $c' "$SETTINGS" > "$TMP"
mv "$TMP" "$SETTINGS"

echo "apply-vscode: colorCustomizations mis à jour (sauvegarde: $SETTINGS.before-material-you)"
