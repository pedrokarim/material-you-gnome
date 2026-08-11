# .references — matériel de référence

Code **non exécutable ici** (Quickshell/QML, cible Arch + Hyprland). Sert de
référence de design et d'algorithmes pour `material-you-gnome`.

## end4-pC

Clone complet de [`pctrade/end4-pC`](https://github.com/pctrade/end4-pC) —
fork de [`end-4/dots-hyprland`](https://github.com/end-4/dots-hyprland)
(illogical-impulse). 664 fichiers, 521 QML, historique git inclus.

### Pertinent pour la couche 1 (pipeline couleurs — déjà faite)

| Chemin | Ce que c'est | Notre équivalent |
|---|---|---|
| `scripts/colors/switchwall.sh` | leur orchestrateur wallpaper→palette (20 ko) | `bin/wallset` |
| `scripts/colors/generate_colors_material.py` | génération Material You en Python | `matugen` (Rust) |
| `scripts/colors/scheme_for_image.py` | choix du schéma selon l'image | option `--scheme` |
| `scripts/colors/applycolor.sh` | propagation aux cibles | nos `hooks/` |
| `scripts/colors/terminal/` | `sequences.txt`, `kitty-theme.conf`, `scheme-base.json` | `templates/ghostty-colors` |
| `scripts/colors/code/material-code-set-color.sh` | recoloration VS Code | `hooks/apply-vscode.sh` |
| `scripts/theming/set-{gtk,icon,cursor}-theme.sh` | bascule thèmes GTK/icônes/curseur | partiellement couvert |

### Pertinent pour la couche 2 (extension GNOME en GJS — pas commencée)

- `screenshots/1-6.png` — **la référence visuelle**, 9,2 Mo. À regarder avant de dessiner quoi que ce soit.
- `modules/ii/` — 224 QML, le catalogue des surfaces :
  `sidebarRight` (56) · `bar` (38) · `background` (32) · `sidebarLeft` (22) ·
  `overlay` (17) · `settings` (12) · puis `overview`, `dock`, `onScreenDisplay`,
  `notificationPopup`, `mediaControls`, `screenCorners`…
- `modules/common/widgets/` — 169 QML de widgets réutilisables (boutons, cartes,
  sliders Material 3). C'est là que vit le vocabulaire visuel.
- `modules/ii/background/shaders/*.qsb` — 9 shaders de transition de fond
  (Doom, Peel, pixelate, circlePit…). Non portables tels quels vers St/Clutter.

### Architecture à connaître

- `services/` — 59 singletons QML : toute la logique (Audio, Battery, Network,
  Notifications, Mpris, Bluetooth, Wallpapers, Weather, Todo, Ai…). **GNOME Shell
  fournit nativement l'équivalent de la plupart** — voir le tableau de traduction
  dans la mémoire projet.
- `services/WM.qml` — abstraction compositeur avec détection via
  `XDG_CURRENT_DESKTOP` et backends `HyprlandBackend` / `NiriBackend`
  (sway et mango prévus, non implémentés). C'est le point d'entrée qu'il faudrait
  étendre pour un hypothétique backend GNOME — mais tout le reste passe encore
  par `WlrLayershell`, donc ça ne suffirait pas.
- `panelFamilies/` — `IllogicalImpulseFamily.qml` + `PanelLoader.qml`, le
  chargeur de « famille » de panneaux (le point d'extension du fork).

### Assets

- `assets/icons/` — 27 SVG symbolic (logos distros, IA, services). Licence GPL-3.0.
- `assets/images/default_wallpaper.png`
- `assets/material_symbols_rounded.json` — 1,7 Mo, **le catalogue des noms
  d'icônes Material Symbols** (utilisé pour la recherche d'icônes). Réutilisable
  tel quel, c'est de la donnée pure.

### Polices — absentes du repo et de la machine

Le repo ne vendore aucune police ; l'installeur upstream les télécharge. Aucune
n'est installée ici (`fc-list` → 0 variante pour chacune) :

`Material Symbols Rounded` · `Space Grotesk` · `Readex Pro` ·
`Google Sans Flex` · `JetBrains Mono NF`

Sans elles, l'identité visuelle ne peut pas être reproduite — **prérequis de la
couche 2**, pas de la couche 1.
