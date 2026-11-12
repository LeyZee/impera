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
- [ ] Captures Nuit/Jour, PC/téléphone validées par Charles.

## Critères d'acceptation

- Aucune étape cochée par un clic : chacune vient de la base. Une étape faite ailleurs apparaît cochée à la réouverture de la fiche.
- Un manager, un chatteur, une créatrice ou un opérateur reçoivent 403 ; le harnais d'isolation passe.
- Aucune migration, aucune écriture.

## Hors périmètre

- La liste « À faire » du Dashboard (W3), chez le fil design.
- La « Mise en route » vue par un manager (il invite des chatteurs depuis l'ADR 0076) : à décider avec Charles.

## Notes de session

- Les heures par défaut de l'agent comptent comme faites et le disent : une étape qu'on ne peut jamais cocher en gardant un choix légitime serait pire qu'un oubli.
- La vérification de fiabilité est de toute l'agence, par plateforme : l'étape est faite quand la dernière vérification de la plateforme de son compte est propre et porte sur des jours où son compte existait.
