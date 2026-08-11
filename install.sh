#!/usr/bin/env bash
# Câble material-you-gnome dans le système. Idempotent : relançable sans risque.

set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

ok(){ echo "  ✓ $*"; }
warn(){ echo "  ⚠ $*" >&2; }

echo "▸ Dépendances"
command -v matugen >/dev/null && ok "matugen $(matugen --version | awk '{print $2}')" \
  || { warn "matugen absent — lance: cargo install matugen"; exit 1; }
command -v jq >/dev/null && ok "jq" || warn "jq absent — le hook VS Code sera ignoré"

echo "▸ Permissions"
chmod +x "$ROOT"/bin/* "$ROOT"/hooks/*.sh
ok "scripts exécutables"

echo "▸ Liens dans le PATH"
mkdir -p "$HOME/.local/bin"
for cmd in wallset wallpicker set-weather reload-shell; do
  ln -sfn "$ROOT/bin/$cmd" "$HOME/.local/bin/$cmd"
done
ok "wallset, wallpicker, set-weather, reload-shell → ~/.local/bin"

echo "▸ Entrée de menu pour le sélecteur"
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
cat > "$APPS/re.ascencia.wallpicker.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Fonds d'écran
Comment=Choisir un fond d'écran, local ou en ligne, et recolorer le système
Exec=$ROOT/bin/wallpicker
Icon=preferences-desktop-wallpaper
Terminal=false
Categories=Utility;DesktopSettings;
DESKTOP
ok "$APPS/re.ascencia.wallpicker.desktop"

echo "▸ Ghostty"
GC="$HOME/.config/ghostty/config"
if [ -f "$GC" ]; then
  if grep -q '^config-file = matugen-colors' "$GC"; then
    ok "include déjà présent"
  else
    # En TÊTE de fichier : ainsi tes réglages manuels plus bas gardent la
    # priorité sur les couleurs générées (ghostty : la dernière valeur gagne).
    cp "$GC" "$GC.before-material-you"
    printf 'config-file = matugen-colors\n\n%s' "$(cat "$GC")" > "$GC.tmp"
    mv "$GC.tmp" "$GC"
    ok "include ajouté en tête (sauvegarde: $GC.before-material-you)"
  fi
else
  mkdir -p "$(dirname "$GC")"
  echo 'config-file = matugen-colors' > "$GC"
  ok "config créé"
fi

echo "▸ btop"
BC="$HOME/.config/btop/btop.conf"
if [ -f "$BC" ]; then
  if grep -q '^color_theme = "material-you"' "$BC"; then
    ok "thème déjà sélectionné"
  else
    cp "$BC" "$BC.before-material-you"
    sed -i 's|^color_theme = .*|color_theme = "material-you"|' "$BC"
    grep -q '^color_theme' "$BC" || echo 'color_theme = "material-you"' >> "$BC"
    ok "color_theme = material-you"
  fi
else
  warn "btop.conf absent — lance btop une fois puis relance ce script"
fi

echo "▸ Extension material-you-gnome"
# Lien symbolique plutôt que copie : le stylesheet généré par matugen atterrit
# dans le projet, et GNOME lit le même fichier.
EXT_UUID="material-you-gnome@karim"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
mkdir -p "$EXT_DIR"
if [ -e "$EXT_DIR/$EXT_UUID" ] && [ ! -L "$EXT_DIR/$EXT_UUID" ]; then
  warn "$EXT_DIR/$EXT_UUID existe et n'est pas un lien — laissé tel quel"
else
  ln -sfn "$ROOT/extension/$EXT_UUID" "$EXT_DIR/$EXT_UUID"
  ok "$EXT_DIR/$EXT_UUID → $ROOT/extension/$EXT_UUID"
fi
# Le schéma GSettings doit être compilé pour que prefs.js et l'extension le
# trouvent ; GNOME lit gschemas.compiled, pas le XML.
if command -v glib-compile-schemas >/dev/null; then
  glib-compile-schemas "$ROOT/extension/$EXT_UUID/schemas" && ok "schéma GSettings compilé"
else
  warn "glib-compile-schemas absent — les réglages ne seront pas disponibles"
fi

echo "▸ Extension user-theme"
if gnome-extensions list --enabled 2>/dev/null | grep -q '^user-theme@'; then
  ok "activée"
else
  gnome-extensions enable user-theme@gnome-shell-extensions.gcampax.github.com 2>/dev/null \
    && ok "activée" || warn "impossible à activer automatiquement"
fi

echo
echo "✓ Installé. Essaie :  wallset ~/Pictures/ton-image.jpg"
