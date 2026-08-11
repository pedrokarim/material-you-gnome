/* material-you-gnome — couche 2 de material-you-gnome.
 *
 * Redessine le top bar de GNOME dans l'esprit d'illogical-impulse, en
 * consommant la palette que `wallset` génère déjà. Les couleurs vivent dans
 * stylesheet.css, produit par matugen : ce fichier ne code aucune couleur.
 *
 * Chaque brique est isolée : si l'une casse (typiquement après une mise à jour
 * de GNOME), les autres continuent de tourner et l'erreur part au journal
 * plutôt que de faire échouer enable() en entier — un enable() qui jette laisse
 * l'extension à moitié appliquée, sans disable() pour nettoyer.
 */

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Islands} from './lib/panel-islands.js';
import {MediaIndicator} from './lib/panel-media.js';
import {Desktop} from './lib/desktop.js';
import {releaseWatcher} from './lib/mpris.js';
import {releaseWeather} from './lib/weather-service.js';
import {releaseLyrics} from './lib/lyrics-service.js';

/* Pas d'indicateur de workspaces ici : GNOME 46 en fournit un nativement
 * (#panelActivities, enfants .workspace-dot) depuis que le bouton Activités a
 * été remplacé. En écrire un deuxième le doublait à l'écran ; il est simplement
 * recoloré dans stylesheet.css. */
const PARTS = [Islands, MediaIndicator, Desktop];

export default class MaterialYouBarExtension extends Extension {
    enable() {
        this._parts = [];

        for (const Part of PARTS) {
            try {
                const part = new Part(this);
                part.enable();
                this._parts.push(part);
            } catch (e) {
                logError(e, `material-you-gnome: ${Part.name} n'a pas démarré`);
            }
        }
    }

    disable() {
        // Ordre inverse de l'activation : les briques qui ajoutent des acteurs
        // au panel se retirent avant celles qui le restylent.
        for (const part of this._parts.reverse()) {
            try {
                part.disable();
            } catch (e) {
                logError(e, 'material-you-gnome: échec au retrait d\'une brique');
            }
        }
        this._parts = [];

        // Les services partagés (MPRIS pour la barre et la carte média, météo
        // pour la carte météo et la carte utilisateur) ne peuvent être libérés
        // qu'ici, une fois tous leurs consommateurs retirés.
        releaseLyrics();   // consommateur de MPRIS : avant lui
        releaseWatcher();
        releaseWeather();
    }
}
