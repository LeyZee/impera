# 2026-11-01 · Les hooks format et lint ne passent plus la liste des fichiers en ligne de commande

Fait : sous Windows, un commit de fusion qui met des milliers de fichiers en scène faisait échouer les hooks `format` et `lint` avec « La ligne de commande est trop longue » : lefthook passait `{staged_files}` en arguments à `prettier` et `eslint` (découverte de la recette sur le PC, 01/11). Les deux hooks appellent maintenant `scripts/staged-check.mjs format|lint`. Le script lit la liste des fichiers en scène par `git diff --cached --name-only --diff-filter=ACMR -z` (ce que contenait `{staged_files}`), la filtre par les extensions des anciens globs et la donne à Prettier et à ESLint par leurs API Node. Aucune ligne de commande ne grandit avec le nombre de fichiers. `.prettierignore` est respecté et les fichiers ignorés par ESLint sont passés sans avertissement, comme avant. À partir de 200 fichiers en scène, le script prévient que la vérification peut prendre quelques minutes (remarque de la relecture sur le PC : 149 s de lint silencieux pour 862 fichiers).

Pas fait : rien.

Décisions : aucune structurante.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm test:scripts` (3 tests de `staged-check.test.mjs`, dont 5 000 fichiers et des chemins avec espaces et accents) ; à la main, un fichier mal formaté en scène fait échouer `format`, un index propre passe `format` et `lint` ; `pnpm check` vert. Relecture sur Windows 11 (Recette PC, tête 96c3067) : 1 623 fichiers en scène acceptés (format 19 s, lint 149 s), alors que la même liste en arguments échoue.
