# SC-02 « Ton prochain script » : la créatrice tourne et dépose carton par carton
Statut : todo (ADR 0055 et 0056 acceptées le 03/11/2026)
Phase : scripts (ADR 0056)
Dépend de : SC-01, CR-06 (amendée par l'ADR 0055), CR-05 (tâches de l'agenda)
Branche : task/sc-02-guided-script-drop

## Objectif
À chaque échéance de la cadence, la créatrice reçoit une demande de script ; elle lit la pile de cartons, remplit chaque emplacement depuis sa galerie, reprend quand elle veut, et envoie le script.

## Contexte à lire
ADR 0056 (§ 2 et § 4), ADR 0055 (§ 2 à 4), CR-06, CR-05, prototype créatrice (`/mnt/project-files/espaces/prototype-creatrice/creatrice.html`, hors dépôt).

## À faire
- [ ] Cadence par créatrice (réglage d'agence, 14 jours par défaut) et job rejouable qui crée la demande `script` avec la prochaine structure de la file ; ambre si la file est vide.
- [ ] Parcours dans la PWA : pile de cartons, un écran par carton avec ses cadres, vérification du format au fil de l'eau, enregistrement à chaque fichier, reprise sur un autre appareil, progression, aperçu final, « Envoyer le script » seulement quand tout emplacement obligatoire est rempli.
- [ ] Un fichier remplacé garde sa position ; un dépôt garde la version de structure de son début.
- [ ] Rappels de l'ADR 0055 § 4.
- [ ] Sans persona active, aucune demande (relecture Agent de SC-01 a) : la demande est fermée par défaut, l'écran de la créatrice le dit en ambre à l'agence ; la file, elle, reste consultable (`personaChecked: false`).
- [ ] Refus des limites au moment de figer (relecture Bilan de SC-01 a) : la demande appelle `structures.freeze` seulement si `disgustBlocks` ne trouve rien sur la persona active de ce moment, sinon elle saute la structure et le dit en ambre. La file seule ne suffit pas : une structure modifiée après son entrée en file, ou une persona qui gagne un dégoût après coup, passerait. Le matcher sera `touchesTerm` des gardes de l'agent (exporté par son index, pli du pluriel, #472) dès sa fusion.
- [ ] Relecture Extension : reprise depuis le serveur, jamais d'un brouillon local (ADR 0053, rien de sensible hors ligne) ; le parcours dit si elle tourne chaque variante ou une seule.

## Critères d'acceptation
- Tests : structure modifiée après son entrée en file pour toucher une limite, puis refusée à la demande ; aucune demande sans persona active ; reprise après coupure, envoi refusé avec un emplacement vide, version figée, cadence sans double demande (rejouable).
- Finition : captures téléphone Nuit et Jour.

## Hors périmètre
Nomenclature et export (SC-03), descriptions (SC-04).

## Notes de session
