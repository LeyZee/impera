# PIL-01 « Mise en route » d'une créatrice et d'un membre, cochée par le serveur
Statut : in_progress
Phase : exploitation
Dépend de : CRM-07, plan de pilotage du 12/11/2026 (W1)
Branche : claude/project-thread-nqhrm0

## Objectif (1 phrase)

Une seule liste « Mise en route » sur la fiche d'une créatrice et sur celle d'un membre, chaque étape cochée par le serveur d'après la base et menant là où elle se fait, pour qu'une arrivée ne dépende plus de la mémoire du propriétaire.

## Contexte à lire (fichiers précis)

- `apps/api/src/modules/supervision/README.md` (section Mise en route), `docs/architecture/modules.md` (vues du tableau de bord).
- `apps/web/src/creators/overview/CreatorsList.tsx` (l'ancien « À configurer », CRM-07 b2), `apps/web/src/screens/team/MemberSheet.tsx`.

## À faire (liste vérifiable)

- [x] Contrats `setup.ts` : étapes, états `done` / `todo` / `waiting`, notes.
- [x] Domaine pur `supervision/domain/setup.ts` et ses tests.
- [x] Lecture `supervision/infra/views/setup-reader.ts` (connexion admin, propriétaire seul) et routes `GET /v1/dashboard/setup/creators` et `/members`, test d'intégration.
- [x] Carte de la liste des Créatrices : « Mise en route · N sur M » et la prochaine étape, à la place de « À configurer ».
- [x] Bloc « Mise en route » en tête de la fiche d'une créatrice et sur la fiche d'un membre, plié sur la prochaine étape.
- [x] Relecture Équipe : étape « Facturation prête » d'un membre payé, invitation expirée à refaire, créatrices archivées hors compte.
- [x] Manager actif : la mise en route des chatteurs, sans leur facturation (« ok manager mise en route », 12/11).
- [x] Retouches du lot 2 : lien expiré en avertissement ambre avec « Nouveau lien » (en tête de la prochaine étape) ; « Facturation prête » dit aussi un versement que bloquerait l'attestation de résidence sous convention (ADR 0041).
- [ ] Captures du lot 3 validées par Charles.

## Critères d'acceptation

- Aucune étape cochée par un clic : chacune vient de la base. Une étape faite ailleurs apparaît cochée à la réouverture de la fiche.
- Créatrices : un manager, un chatteur, une créatrice ou un opérateur reçoivent 403. Membres : un chatteur, une créatrice ou un opérateur reçoivent 403 ; un manager actif ne reçoit que les chatteurs, sans « Facturation ». Le harnais d'isolation passe.
- Aucune migration, aucune écriture.

## Hors périmètre

- La liste « À faire » du Dashboard (W3), chez le fil design.
- « Ma mise en route » vue par le chatteur lui-même : découverte, pas faite ici.

## Notes de session

- Les heures par défaut de l'agent comptent comme faites et le disent : une étape qu'on ne peut jamais cocher en gardant un choix légitime serait pire qu'un oubli.
- La vérification de fiabilité est de toute l'agence, par plateforme : l'étape est faite quand la dernière vérification de la plateforme de son compte est propre et porte sur des jours où son compte existait.
