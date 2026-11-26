# COF-02 Médias : « À refaire » sur un dépôt
Statut : in_progress
Phase : coffre (trou 7 du rapport « trous béants » du 21/11/2026, validé par Charles)
Dépend de : dépôts de contenu et demandes (CR-06, ADR 0055), faits
Branche : claude/project-thread-53kkgu
Propriétaire : Médias ; revue Bilan (base, contrats, serveur), Design (apps/web), Sécurité (garde de la colonne)

## Objectif (1 phrase)

L'agence renvoie un dépôt à la créatrice avec une phrase, sa demande se rouvre et elle lit la phrase sur sa carte.

## Pourquoi maintenant

Le rapport du 21/11 : un dépôt raté ne pouvait que disparaître de son écran sans un mot, un dépôt dont rien n'a été gardé comptait « Déposée », et les routes de retrait de l'agence n'avaient pas d'écran.

## À faire (liste vérifiable)

- [x] Base : `content_drops.redo_sentence` (1 à 200 caractères, seulement sur un dépôt retiré), écrite par l'équipe avec le retrait, jamais par elle (déclencheur).
- [x] Base : un dépôt bloqué peut être retiré ; il garde sa raison (la contrainte l'en empêchait).
- [x] Serveur : `POST /v1/creators/:creatorId/drops/:id/redo` (propriétaire, manager), journal `content_drop.redo`.
- [x] Lecture : la demande porte `redo` (phrase de l'agence, ou raison du blocage quand rien n'a été gardé) ; `redone` liste 14 jours les dépôts sans demande renvoyés.
- [x] Un dépôt bloqué ne répond plus à sa demande ; le dépôt suivant (ou le script commencé) le retire.
- [x] Écran agence : « À refaire » sur chaque dépôt pas encore publié, fenêtre avec la phrase et trois débuts en un geste ; « À refaire » dans Demandes.
- [x] Écran créatrice : la phrase en ambre sur la carte de la demande ; « Ton dernier envoi est revenu » avec « Déposer à nouveau ».
- [x] Tests : domaine, base (garde et contrainte), intégration (route, demande rouverte, dépôt bloqué remplacé), écrans.
- [x] Captures Nuit/Jour, PC/téléphone, avis Design (« ok captures a-refaire-1 », 21/11).

### Second temps : un seul média (demande de Charles par le fil Coffre, 21/11)

- [x] Base : `content_drop_files.redo_sentence`, `redo_at`, `redo_by` ; politique `team_redo` (propriétaire, manager ; dépôt reçu, prêt ou bloqué, pas publié sauf un script) ; garde : jamais elle.
- [x] Base : son remplacement sous son propre compte, par deux politiques (relecture Sécurité) : `creator_redo_replace` ne laisse passer `replaced_at` que de vide à rempli, sur un fichier demandé à refaire ou refusé ; `creator_redo_insert` n'accepte le nouveau fichier qu'à la place et à l'étape d'un fichier remplacé du même dépôt, en attente de ses octets. Le dépôt ne change pas d'état à ce moment-là : la réception du nouveau fichier (`follow`, rôle de service, déjà là) le remet prêt ou bloqué et, pour un script copié dans Reveal, retire « Copié dans Reveal » (`app.export_reset`, jamais le rôle de l'appli). Plafond du rôle de service inchangé.
- [x] Serveur : `POST /v1/creators/:creatorId/drops/:id/files/:fileId/redo` (204) et `POST /v1/creator-space/drops/:id/files/:fileId/replace` (200, le dépôt) ; journal `content_drop_file.redo` et `content_drop_file.replace` ; l'archive refuse (`redo_pending`) tant qu'un média attend d'être remplacé ou que son remplaçant n'est pas reçu.
- [x] Contrat : `ContentDropFile.redo`, `replacementRefusal`, `REDOABLE_DROP_STATES`.
- [x] Web : `redoDropFile` (agence, pour l'écran du coffre), `replaceDropFile` puis `queueSend` ; carte de la créatrice : la phrase en ambre sur la ligne du média et « Remplacer » (aussi sur un fichier refusé) ; le remplaçant montre son envoi, la carte dit « En envoi » puis « Reçu » jusqu'à sa réception.
- [x] Tests : contrat, base, intégration, écrans.
- [x] Captures de « Remplacer », avis Design ; validées par Charles le 21/11 (lot remplacer-1, sans retouche).

## Critères d'acceptation

- Un chatteur et la créatrice n'écrivent jamais la phrase ; un dépôt publié ne se refait plus.
- Rejoué, « À refaire » répond pareil et garde la première phrase.
- Dès qu'elle redépose, la phrase disparaît.

## Hors périmètre

- L'écran du coffre où l'équipe demande un média à refaire : fil Coffre (il appelle `redoDropFile`).
- La pause de l'IA sur un script à recopier : fil Scripts.
- « Changer de catégorie » à l'écran (la route PATCH existe) : à proposer avec les captures.

## Notes de session

- 21/11 : migration 0258 (numéro de Bilan, prevId provisoire jusqu'au passage de #996 et #980).
