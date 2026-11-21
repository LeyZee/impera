# 2026-11-16 — Vitrine : insigne de rang et CHT-17 (PR B)

- **Tâche** : PROPOSED-trophy-case (suite, recette du 16/11).
- **Fait** :
  - insigne de rang `LevelInsignia` (44 px, sans lueur) en tête de la vitrine du chatteur ;
  - « Premier rang : X, à N € de net depuis ton arrivée » tiré de `nextLevel` quand aucun rang n'est atteint (centimes seulement si le seuil n'est pas rond) ;
  - étagère Médailles gardée sans palier, avec le message « L'agence n'a pas encore posé de paliers de prime. Tes médailles apparaîtront ici. », calé à gauche (prop `emptyShelves`, `shelvesOf(…, keepEmpty)`) ;
  - mention du trophée PPV compté sur les ventes lues (ADR 0118).
- **Tests** : `arrange.test.ts`, `HerTrophiesPage.test.tsx` (rang atteint, premier rang, aucun rang, étagère vide), `chatter-case.test.tsx`.
- **Captures** : recette/2026-11-16/vitrine-rang-b-2 (10 images).
- **Reste** : la phrase de rang de l'ADR 0118, à poser après la PR de Chiffres.
