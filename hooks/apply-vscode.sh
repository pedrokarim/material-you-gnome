#!/usr/bin/env bash
# Injecte les couleurs Material You dans VS Code via workbench.colorCustomizations.
#
# settings.json contient déjà des réglages perso (police, thème, extensions).
# On merge avec jq au lieu d'écraser, et on ne touche QUE la clé
# workbench.colorCustomizations. Une sauvegarde est faite au premier passage.
#
# Garde-fou de polarité : `colorCustomizations` ne repeint que le châssis et le
# fond de l'éditeur — les couleurs de syntaxe, elles, restent celles du thème
# VS Code. Poser un fond clair sous un thème sombre (ou l'inverse) donne donc du
# texte illisible. Quand la polarité du thème actif ne correspond pas au mode de
# la palette, on retire l'injection au lieu de l'appliquer.

set -euo pipefail

COLORS="${XDG_CACHE_HOME:-$HOME/.cache}/material-you-gnome/colors.sh"
SETTINGS="$HOME/.config/Code/User/settings.json"
BACKUP="$SETTINGS.before-material-you"

[ -f "$SETTINGS" ] || { echo "apply-vscode: pas de settings.json, ignoré"; exit 0; }
[ -f "$COLORS" ] || { echo "apply-vscode: $COLORS absent" >&2; exit 1; }
command -v jq >/dev/null || { echo "apply-vscode: jq requis" >&2; exit 1; }

# shellcheck source=/dev/null
source "$COLORS"

[ -f "$BACKUP" ] || cp "$SETTINGS" "$BACKUP"

# Remet la clé telle qu'elle était avant la première exécution — donc l'absence
# de clé si l'utilisateur n'en avait pas.
restore_original() {
  local original tmp
  original=$(jq -c '.["workbench.colorCustomizations"] // empty' "$BACKUP")
  tmp=$(mktemp)
  if [ -n "$original" ]; then
    jq --argjson c "$original" '.["workbench.colorCustomizations"] = $c' "$SETTINGS" > "$tmp"
  else
    jq 'del(.["workbench.colorCustomizations"])' "$SETTINGS" > "$tmp"
  fi
  mv "$tmp" "$SETTINGS"
}

# `uiTheme` du thème actif, lu dans le package.json de l'extension qui le
# fournit — c'est la seule source fiable : le nom du thème ne dit rien de sa
# polarité (« Monokai Pro Light » et « Tokyo Night » ne s'annoncent pas de la
# même façon). Les thèmes livrés avec VS Code nomment leurs libellés par des
# clés NLS (`%darkPlusColorThemeLabel%`) qu'il faut résoudre dans
# package.nls.json.
theme_ui_kind() {
  local wanted="$1" file dir nls found
  for file in "$HOME"/.vscode/extensions/*/package.json \
              /snap/code/current/usr/share/code/resources/app/extensions/*/package.json \
              /usr/share/code/resources/app/extensions/*/package.json; do
    [ -f "$file" ] || continue
    dir=$(dirname "$file")
    nls="$dir/package.nls.json"
    [ -f "$nls" ] || nls=/dev/null

    found=$(jq -r --arg w "$wanted" --slurpfile nls "$nls" '
      ($nls[0] // {}) as $n
      | (.contributes.themes // [])[]
      | ((.label // .id // "")
         | if startswith("%") and endswith("%") then ($n[.[1:-1]] // .) else . end) as $label
      | select($label == $w)
      | .uiTheme // "vs-dark"
    ' "$file" 2>/dev/null | head -1)

    [ -n "$found" ] && { echo "$found"; return 0; }
  done
  return 1
}

# Sans réglage explicite, VS Code ouvre sur son thème sombre par défaut.
THEME=$(jq -r '.["workbench.colorTheme"] // "Dark Modern"' "$SETTINGS")
UI_KIND=$(theme_ui_kind "$THEME" || true)

case "$UI_KIND" in
  vs|hc-light)      THEME_MODE=light ;;
  vs-dark|hc-black) THEME_MODE=dark ;;
  *)                THEME_MODE='' ;;
esac

if [ -z "$THEME_MODE" ]; then
  echo "apply-vscode: polarité de « $THEME » indéterminée, injection tentée quand même" >&2
elif [ "$THEME_MODE" != "$MY_MODE" ]; then
  restore_original
  echo "apply-vscode: « $THEME » est un thème $THEME_MODE, la palette est en $MY_MODE —"
  echo "              injection retirée (elle rendrait l'éditeur illisible)."
  echo "              Choisir un thème $MY_MODE dans VS Code, ou passer GNOME en $THEME_MODE."
  exit 0
fi

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

echo "apply-vscode: colorCustomizations mis à jour (sauvegarde: $BACKUP)"
