# EQ-17 Mise en service de la paie : rien de réel avant que tout soit prouvé
Statut : in_progress (ID validé par Charles le 27/10/2026, 15h11 : « je les veux tous »)
Phase : équipe (ADR 0023), dernière étape de la chaîne de paie, au déploiement
Dépend de : EQ-04, EQ-05, EQ-06, EQ-15, le déploiement (Hetzner, Coolify), `docs/runbooks/restore.md`
Branche : task/eq-17-payroll-go-live

## Objectif
La première vraie paie et la première vraie facture ne partent que lorsque les sauvegardes, le comptable, la double authentification et un calcul à blanc sont prouvés, et l'application montre l'état de chacun.

## Contexte à lire
`docs/architecture/operations.md` (§ Données), `docs/runbooks/restore.md` (« une sauvegarde non testée n'existe pas »), ADR 0023 (§ Paie, § Factures), EQ-04, EQ-05, EQ-06 (le comptable valide contrat, mandat, régimes et première facture), EQ-15. Imperium s'est arrêté sans sauvegarde : son historique est perdu. C'est la leçon numéro un.

## À faire
- [ ] **État de la mise en service** dans Réglages › Plateformes et paie, une ligne par condition, chacune avec sa preuve et sa date : sauvegarde quotidienne réussie depuis moins de 26 h (ADR 0028 § 5) ; essai de restauration réussi de moins de 90 jours (ADR 0028 § 6) : un vrai export de production restauré sur le PC de Charles par une session Remote Control (`docs/runbooks/restore.md` § B), saisi par le propriétaire avec sa date, sa durée, ses écarts et l'empreinte SHA-256 de l'export, que le serveur rapproche d'une ligne réussie de `backup_runs` ; validation du comptable (contrat, mandat, chaque régime, facture à blanc), saisie par le propriétaire avec la date et les versions des textes ; double authentification active pour le propriétaire et chaque manager ; coordonnées de l'agence complètes (raison sociale, adresse, SIREN, numéro de TVA) ; source du taux de change à jour.
- [ ] **Gardes dans le serveur** : tant que la validation du comptable n'est pas enregistrée, aucune facture réelle n'est émise (le relevé reste validable, comme dans EQ-06) ; tant que la double authentification manque à un manager, il ne valide rien (EQ-15). Ces gardes ne se désactivent pas « pour tester ».
- [ ] **Paie à blanc** : une première quinzaine calculée en parallèle, relevés vérifiés à la main sur un tableur par Charles avant de marquer quoi que ce soit « payé » ; l'écart éventuel est expliqué ligne par ligne, puis corrigé dans le moteur avec un cas de test, jamais à la main dans un relevé.
- [x] **Sauvegarde visible** (fil Mise en production, OPS-02) : l'export tourne hors de l'application (service `backup`, ADR 0028) ; il écrit son résultat dans `backup_runs` avec le rôle admin, et l'application lit cette table, jamais un fichier du serveur ; après 26 h sans export réussi, un avertissement ambre sur le Dashboard du propriétaire et une alerte Telegram. Un essai de restauration de moins de 90 jours est exigé (`restoreTestFresh`, `RESTORE_TEST_FRESH_DAYS`), comme le test trimestriel du runbook.
- [x] **Saisie de l'essai de restauration** : Réglages › Sauvegardes (propriétaire seul, connexion de moins de 10 minutes) montre la sauvegarde de la nuit et le dernier essai, et « Noter un essai » enregistre le compte rendu collé de la session (`POST /v1/backups/restore-tests`).
- [ ] **Garde de paie** : une paie réelle ne se valide pas sans essai frais (`modules.backups.restoreTestFresh(at)`), branchée avec le module de paie (EQ-04).
- [ ] **Archive des factures** : chaque année, factures, avoirs, journal des achats et récapitulatif DAS2 exportés hors du serveur et gardés dix ans (Code de commerce L123-22), indépendamment des sauvegardes de 30 jours ; l'export est vérifié (empreintes SHA-256 relues).
- [ ] Une recette écrite dans `docs/runbooks/` : l'ordre des preuves, qui fait quoi, et ce qu'on fait si une preuve manque le jour de la paie.

## Critères d'acceptation
- Tests : sans validation du comptable, la validation d'une période réussit et n'émet aucune facture ; avec, elle en émet ; un export de base plus vieux que 26 h affiche l'avertissement ; sans essai de restauration réussi de moins de 90 jours, une paie réelle ne se valide pas ; l'archive annuelle relue donne les mêmes empreintes que les PDF stockés.
- La recette a été jouée une fois sur le vrai déploiement, et son résultat est dans le journal des sessions.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Rapprochement bancaire (Qonto), transmission à une plateforme agréée (EQ-06, hors périmètre), déploiement lui-même.

## Notes de session
- 27/10/2026 (fil Équipe ; découverte du fil Mise en production, OPS-01) : l'export quotidien chiffré hors du fournisseur de base, que décrivent `docs/architecture/operations.md` § Données et la procédure B de `docs/runbooks/restore.md`, n'existe pas encore ; seul le PITR du fournisseur protège la base. Il doit tourner, et une restauration depuis lui avoir été jouée, avant la première vraie paie : sans lui, la ligne « export quotidien » de l'état de mise en service n'a pas de preuve et la paie réelle ne démarre pas.
- 27/10/2026 (fil Équipe) : la tâche suit ADR 0028 (26 h, essai sur le PC de Charles saisi par le propriétaire, empreinte rapprochée de `backup_runs`). Les deux lignes des sauvegardes vivent dans Réglages › Sauvegardes ; l'état de mise en service les reprendra avec les autres conditions quand elles existeront (comptable EQ-06, double authentification EQ-15, coordonnées, taux de change). Reste : la garde de paie avec EQ-04, l'archive annuelle des factures, la recette.
