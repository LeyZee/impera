# 2026-10-22 · `pnpm check` et les tests verts sous Windows (recette sur le PC)

Fait : la recette du 19/10 sur le PC de Charles (Windows 11) trouvait `pnpm check`, `pnpm test` et `pnpm test:integration` rouges pour des raisons propres à Windows. Les causes sont corrigées.
- `shutdown.integration.test.ts` lançait `node_modules/.bin/tsx`, un script shell que `spawn` ne sait pas exécuter sous Windows (ENOENT), et knip y voyait une dépendance non déclarée. Le test lance maintenant Node avec le chargeur de tsx (`process.execPath --import tsx`). Le cas SIGTERM est sauté sous Windows, qui n'a pas de SIGTERM : `kill` y termine le processus sans laisser l'arrêt propre s'exécuter.
- `scripts/check-repo.mjs` comparait des chemins Windows (`scripts\check-repo.mjs`) à des chemins POSIX : il signalait ses propres TODO. Les chemins relatifs passent en `/` sur tous les systèmes.
- `EPERM rmdir node_modules\.vitest-cache` : tous les paquets partageaient le cache de modules de Vitest à la racine, et `pnpm test` les lance en parallèle ; un paquet qui vide ce cache (lockfile changé) gênait les autres. Chaque script `vitest run` range désormais son cache dans le `node_modules` de son paquet.
- Le hook `commit-msg` refusait tout commit sous Windows : lefthook y enveloppe la commande dans `sh -c "…"`, et les guillemets du one-liner shell cassaient cette enveloppe (`syntax error: unexpected end of file`). La vérification Conventional Commits passe dans `scripts/commit-msg.mjs`, testé par `pnpm test:scripts`.
- `boundaries.test.ts` construisait une instance ESLint (et sa configuration typée) par test, et dépassait 30 s sous charge. Une seule instance pour le fichier, et une marge de 90 s pour la première construction.

Pas fait : les 3 tests de `ffmpeg-media-tools.test.ts` restent rouges sur un PC sans ffmpeg (prérequis documenté) ; le contrôle de ffmpeg au démarrage est confié au fil agent.

Décisions : aucune structurante.

Découvertes : l'EPERM n'a pas pu être reproduit à la demande (le nettoyage du cache dépend d'un changement de lockfile) ; la correction retire la cause, un dossier partagé par des processus parallèles.

Candidats à suppression : aucun.

Vérifié sur Windows 11 : `pnpm check` ✓ ; `pnpm test` ✓ hormis les 3 tests ffmpeg ; `pnpm test:integration` ✓ (db 34, api 106 + 1 sauté) ; `node --import tsx src/worker.ts` démarre bien le worker sous Windows ; le hook `commit-msg` accepte un message conforme et refuse « bad message ».
