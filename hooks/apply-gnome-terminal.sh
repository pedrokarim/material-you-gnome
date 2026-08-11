#!/usr/bin/env bash
# Recolore le profil GNOME Terminal par défaut.
#
# GNOME Terminal ne lit aucun fichier de config : tout vit dans dconf. On ne
# peut donc pas passer par un template matugen, d'où ce hook.

set -euo pipefail

COLORS="${XDG_CACHE_HOME:-$HOME/.cache}/material-you-gnome/colors.sh"
[ -f "$COLORS" ] || { echo "apply-gnome-terminal: $COLORS absent" >&2; exit 1; }
command -v gsettings >/dev/null || exit 0
# shellcheck source=/dev/null
source "$COLORS"

BASE=org.gnome.Terminal.ProfilesList
PROFILE=$(gsettings get $BASE default 2>/dev/null | tr -d "'") || exit 0
[ -n "$PROFILE" ] || exit 0

SCHEMA="org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:$PROFILE/"

gsettings set "$SCHEMA" use-theme-colors false
gsettings set "$SCHEMA" background-color "$MY_SURFACE"
gsettings set "$SCHEMA" foreground-color "$MY_ON_SURFACE"
gsettings set "$SCHEMA" use-theme-transparency false
gsettings set "$SCHEMA" bold-color-same-as-fg true
gsettings set "$SCHEMA" cursor-colors-set true
gsettings set "$SCHEMA" cursor-background-color "$MY_PRIMARY"
gsettings set "$SCHEMA" cursor-foreground-color "$MY_ON_PRIMARY"
gsettings set "$SCHEMA" highlight-colors-set true
gsettings set "$SCHEMA" highlight-background-color "$MY_SECONDARY_CONTAINER"
gsettings set "$SCHEMA" highlight-foreground-color "$MY_ON_SECONDARY_CONTAINER"
gsettings set "$SCHEMA" palette "$MY_TERM_PALETTE_GVARIANT"

echo "apply-gnome-terminal: profil $PROFILE recoloré"
