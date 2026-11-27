# H-01 Première session d'hygiène

Statut : superseded (relevé du 27/11/2026, décidé par Charles sur recommandation du fil « Remettre la documentation au propre » : knip, l'audit des dépendances et check-repo tournent dans `pnpm check` et la CI ; le rangement des docs du 27/11 a fait le reste) ; statut précédent : todo
Phase : 0 (après P0-07b)
Dépend de : P0-07b
Branche : task/h-01-first-hygiene-pass

## Objectif
Appliquer `docs/conventions/hygiene.md` une première fois sur le dépôt réel, et corriger la politique si elle s'avère impraticable.

## Contexte à lire
`docs/conventions/hygiene.md`, ADR 0014, `docs/sessions/LOG.md` (Candidats à suppression).

## À faire
- `knip`, `pnpm audit`, `node scripts/check-repo.mjs --strict` (chemins cités, noms interdits, fichiers > 500 Ko, `TODO` sans fiche), taille du dépôt (`git count-objects -vH`).
- Traiter chaque « Candidat à suppression » du LOG selon la procédure en 4 étapes (dont `demo.echo` si encore présent).
- Vérifier que chaque fiche `done` a sa PR fusionnée et son entrée LOG ; que chaque doc d'architecture a une date de revue ; que les READMEs des modules reflètent le code.
- Vérifier que les docs ne contredisent pas le code (ex. noms de jobs, routes) ; corriger les docs, pas le code, sauf bug.
- Amender `hygiene.md` si une étape est inutile ou manquante (PR séparée `docs:`).

## Critères d'acceptation
- Commit(s) `chore(cleanup)` séparés, chacun avec justification.
- LOG : section « Candidats à suppression » vide ou chaque entrée a une décision datée.
- `pnpm check` vert.

## Hors périmètre
Toute fonctionnalité.

## Notes de session
