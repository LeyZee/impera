# CRB-01 Trophées et médailles de série de la créatrice
Statut : in_progress (lot 1 fusionné le 15/11, #762 ; corrections de la recette du 16/11 en cours, puis lot 2)
Phase : créatrice (ADR 0107 ; ADR 0042 § 3, ADR 0055 § 4, ADR 0104 § B)
Dépend de : ADR 0107 (acceptée le 13/11/2026) ; la PR du jeu du chatteur (module `rewards`, migration 0186, #740) ; PR #720 et PR des médailles du chatteur (composant de dévoilement et langage graphique partagés)
Branche : claude/project-thread-vnzrdd
Propriétaire proposé : le fil « Récompenser la créatrice avec des badges » ; relecteurs Design/UX (écrans, dessins), Bilan (base, job), Médias (dépôts et demandes)

## Objectif (1 phrase)

La créatrice gagne des médailles à chaque palier de sa série de journées réussies et des trophées pour ses dépôts et ses demandes livrées à l'heure, avec le dévoilement du chatteur, sans que le jeu touche jamais l'argent ni ne lui reproche un refus.

## Contexte à lire (fichiers précis)

- ADR 0107 (toutes les règles), ADR 0104 § B, ADR 0042 § 3 et § 7, ADR 0055 § 4 à § 6.
- `apps/api/src/modules/creator-tasks/domain/streak.ts` (série de journées), `packages/db/src/schema/content-drops.ts` (`content_requests`, `content_drops.request_id`).
- `apps/web/src/screens/agenda/DayView.tsx` (série affichée à côté de sa journée), `apps/web/src/screens/me/`.

## À faire (liste vérifiable)

- [x] Domaine pur et testé : série de livraisons (§ 2), constat des neuf trophées (§ 3), médaille du palier atteint (§ 1).
- [x] Migration 0208 (attribuée le 15/11 ; idx 148 tant que la 0207 de Parts n’est pas sur main, puis 149) dans le module `rewards` : types de la créatrice ajoutés à la liste fermée de la table commune des gains, politiques RLS de la créatrice, test RLS (elle lit les siens et marque un dévoilement vu ; l'agence lit ; un chatteur ne lit rien). Pas de seconde table. Relecture Bilan (13/11) : politiques rattachées au compte du gain ; lecture agence limitée aux rôles propriétaire et manager actif ; GRANT UPDATE de la seule colonne du dévoilement vu au rôle applicatif, sur la ligne de son compte, ni autre UPDATE ni DELETE ; INSERT à `impera_service` (après #716) vérifié par le test des droits ; job en ON CONFLICT DO NOTHING.
- [~] Job rejouable : la tâche `rewards.evaluate` (toutes les 10 minutes, jour et nuit) constate aussi les gains de la créatrice. Reste : la lancer aussi juste après une coche et un dépôt arrivé (lot 2).
- [x] Route de la vitrine au harnais d'isolation ; test « une créatrice ne lit pas les trophées d'une autre ».
- [~] Écrans : médaille à côté de la série et dévoilement faits (lot 1) ; « Mes trophées » dans Moi branché par le fil de la vitrine (ADR 0108) sur `creator-art.tsx` ; reste la lecture sur sa fiche côté agence (route `GET /v1/creators/:creatorId/trophy-case` prête, écran au lot 2).
- [x] Symboles de la créatrice dessinés dans le langage des médailles du chatteur, rendus en grand et à 24 à 40 px, Nuit et Jour, validés par Charles.
- [x] Glossaire : « Trophée » élargi à la créatrice.
- [x] Captures Nuit/Jour, PC/téléphone validées avant fusion (lot `trophees-creatrice-1`, validé par Charles le 15/11).

### Recette du 16/11 (`recette/2026-11-16/recette-chatteur-creatrice/RAPPORT.md`), demandée par Charles en entier, mineures comprises

PR A, majeures :
- [x] CRE-03 : une coche de routine d'un jour fini ne se décoche plus (422 `creator_day_closed_unprocessable`, `untickTimely`) ; la coche est dessinée, plus pressée, sur l'Agenda et dans la fenêtre de la tâche.
- [x] CRE-07 : aucune coche sur la routine d'un jour à venir (un anneau vide se lit comme une case à cocher) ; la raison dite dans la fenêtre de la tâche.
- [x] CRE-01 : « Sons » dans Moi › Préférences pour la créatrice.
- [x] CRE-02 : sa meilleure série à côté de la série en cours, et sa meilleure suite de livraisons, une fois cassées.
- [x] CHT-05 : pas d'onglet « Trophées » pour un manager, même en congé (même règle que la route).

PR B, mineures :
- [x] CRE-06 : `rewards.evaluate_creator` demandé dans la transaction d'une coche ou d'un dépôt arrivé ; l'écran relit sa vitrine 4 s puis 12 s après.
- [x] Créatrice archivée hors du job (remarque Bilan).
- [x] CRE-13 : la pastille de série mène à Mes trophées ; le nom de la médaille dans son nom accessible.
- [x] CHT-10 et CRE-18 : carillon seulement après un geste, un seul contexte audio.
- [x] CRE-14 : unité `once` (0 sur 1) pour un trophée d'un geste, « Premier dépôt » en tête pour une nouvelle ; « Encore 5 ».
- [x] CRE-15 : « Coche toutes tes routines du jour ».
- [x] CRE-17 : textes pour elle ; « Stock plein » et « Contenu qui a cartonné » cachés tant que leur signal manque.
- [x] Bandeau d'un jour à venir : « N choses prévues », jamais une routine pour commencer (Design).
- [x] Une routine retirée reste due le jour même (`removedAt`), choix de Charles du 16/11.
PR C : sa vitrine sur sa fiche côté agence (lot 2).

## Critères d'acceptation

`pnpm check`, `pnpm test:all` verts ; refuser une demande avant son échéance ne casse pas la série ; rejouer le job ne donne rien deux fois ; aucune notification envoyée par le jeu.

## Hors périmètre

Niveaux, primes, trophées sur les ventes ou les gains, classement entre créatrices.

## Notes de session
