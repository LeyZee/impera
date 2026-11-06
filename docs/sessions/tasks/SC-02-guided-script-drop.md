# SC-02 « Ton prochain script » : la créatrice tourne et dépose carton par carton
Statut : en cours, lot a (cadence, API et job) fait le 05/11/2026 ; lot b1 (API du dépôt par emplacements) fait le 06/11/2026 ; lot b2 (parcours dans la PWA) fait le 06/11/2026 ; écran d'agence des demandes et de la cadence fait le 06/11/2026 (MED-09) ; restent les rappels de l'ADR 0055 § 4 et `touchesTerm`
Phase : scripts (ADR 0056)
Dépend de : SC-01, CR-06 (amendée par l'ADR 0055), CR-05 (tâches de l'agenda)
Branche : task/sc-02-guided-script-drop

## Objectif
À chaque échéance de la cadence, la créatrice reçoit une demande de script ; elle lit la pile de cartons, remplit chaque emplacement depuis sa galerie, reprend quand elle veut, et envoie le script.

## Contexte à lire
ADR 0056 (§ 2 et § 4), ADR 0055 (§ 2 à 4), CR-06, CR-05, prototype créatrice (`/mnt/project-files/espaces/prototype-creatrice/creatrice.html`, hors dépôt).

## À faire
- [x] Cadence par créatrice (réglage d'agence, 14 jours par défaut) et job rejouable qui crée la demande `script` avec la prochaine structure de la file ; ambre si la file est vide. (Lot a : `script_cadences`, `GET`/`PUT /v1/creators/:creatorId/script-cadence`, job horaire `scripts.ask_scripts`, une demande par jour d'échéance, demandée 7 jours avant ; file vide : la dernière structure redemandée, `reused`.)
- [ ] Parcours dans la PWA : pile de cartons, un écran par carton avec ses cadres, vérification du format au fil de l'eau, enregistrement à chaque fichier, reprise sur un autre appareil, progression, aperçu final, « Envoyer le script » seulement quand tout emplacement obligatoire est rempli.
- [x] Un fichier remplacé garde sa position ; un dépôt garde la version de structure de son début. (Lot a : la demande porte `structure_version_id`, figée. Lot b1 : emplacements `<segment>:<série>:<rang>`, `replaced_at`, « Envoyer le script » refusé tant qu'un emplacement obligatoire est vide ; une demande faite à la main fige aussi sa version.)
- [ ] Rappels de l'ADR 0055 § 4.
- [x] Sans persona active, aucune demande (relecture Agent de SC-01 a) : la demande est fermée par défaut, l'écran de la créatrice le dit en ambre à l'agence ; la file, elle, reste consultable (`personaChecked: false`).
- [x] Refus des limites au moment de figer (relecture Bilan de SC-01 a) : la demande appelle `structures.freeze` seulement si `disgustBlocks` ne trouve rien sur la persona active de ce moment, sinon elle saute la structure et le dit en ambre. La file seule ne suffit pas : une structure modifiée après son entrée en file, ou une persona qui gagne un dégoût après coup, passerait. Le matcher sera `touchesTerm` des gardes de l'agent (exporté par son index, pli du pluriel, #472) dès sa fusion. (Lot a : la structure est relue sur la version figée elle-même ; le matcher reste `disgustBlocks`, le passage à `touchesTerm` change aussi la file de SC-01 et vient en lot à part.)
- [ ] Relecture Extension : reprise depuis le serveur, jamais d'un brouillon local (ADR 0053, rien de sensible hors ligne) ; le parcours dit si elle tourne chaque variante ou une seule.

## Critères d'acceptation
- Tests : structure modifiée après son entrée en file pour toucher une limite, puis refusée à la demande ; aucune demande sans persona active ; reprise après coupure, envoi refusé avec un emplacement vide, version figée, cadence sans double demande (rejouable).
- Finition : captures téléphone Nuit et Jour.

## Hors périmètre
Nomenclature et export (SC-03), descriptions (SC-04).

## Notes de session
- 05/11/2026, lot a (migration 0121) : cadence, version figée sur la demande, job horaire. Reste : lot b (emplacements du dépôt de script, parcours carton par carton, captures), rappels de l'ADR 0055 § 4, `touchesTerm`, l'écran d'agence de la cadence (ambre).
- 06/11/2026, lot b1 (migration 0122) : API du dépôt de script par emplacements (début, reprise, remplissage, remplacement, envoi), durée vérifiée sur le fichier nettoyé, original d'un fichier remplacé effacé. Reste : lot b2 (parcours PWA, route créatrice des cartons de sa version figée, captures Nuit et Jour), rappels de l'ADR 0055 § 4, `touchesTerm`, écran d'agence de la cadence.
- 06/11/2026, lot b2 (sans migration) : route créatrice des cartons de sa version figée ; dans la PWA, « Commencer » sur une demande de script à version figée, « Continuer » sur un script en cours, un écran par carton (une série par carton pour une étape à variantes) avec ses emplacements, genre et durée vérifiés sur le téléphone avant tout envoi, chaque fichier envoyé dès qu'il est choisi, aperçu final et « Envoyer le script ». Reste : rappels de l'ADR 0055 § 4, `touchesTerm`, écran d'agence de la cadence.
- 06/11/2026, écran Demandes (MED-09 et MED-10, sans migration, « ok écran demandes » de Charles) : onglet « Demandes » de la fiche de la créatrice (propriétaire, manager actif) avec ses demandes en cours, refusées (avec sa raison) et annulées ; « Demander un contenu » (catégorie, jour, raison, structure d'un script, le moment fixé par l'alternance) ; « Annuler » seulement sur une demande qu'elle n'a pas commencée ; la cadence lue par tous, réglée par le propriétaire (1 à 90 jours), avec ce qu'elle a fait en dernier (ambre quand elle a besoin d'une main). Un jour passé dans son fuseau est refusé par le serveur (422 `content_request_due_unprocessable`) ; un jour d'une autre année dit son année. Reste : rappels de l'ADR 0055 § 4, `touchesTerm`.
