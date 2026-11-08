# 2026-11-08 · Ordre des migrations et gitleaks de nuit

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : action 3 du bilan projet (`docs/bilans/2026-11-08-bilan-projet.md`, R4), « test ordre migrations »

- Fait : `packages/db/src/migrations-order.test.ts`. Le test refuse un journal dont les numéros ou les `when` ne sont pas strictement croissants, un fichier SQL sans entrée (ou l'inverse), un snapshot manquant ou dont le `prevId` ne suit pas, et un plus grand snapshot qui n'est pas celui de la dernière entrée. Vérifié en abaissant à la main le `when` de la dernière entrée : le test échoue avec le message attendu.
- README de `packages/db` : section « Numéros de migration entre fils ».
- Découvertes : le snapshot de 0124 (`password_reset_links`, #581) n'a jamais été commité. 0125 pointe vers un `prevId` absent. C'est une exception nommée dans le test.
- Gitleaks de nuit, rouge depuis le 30/10 : le scan de tout l'historique trouvait un seul faux positif, le jeton de test alphabétique de `ExtensionLinksPanel.test.tsx` (commit 0cc8fdd92), déjà remplacé par `'x'.repeat(43)` dans `main`. Son empreinte va dans `.gitleaksignore` (« ok gitleaks » du fil Bilan). `gitleaks git` 8.24.2 en local sur les 2078 commits : plus aucune fuite. Règle ajoutée dans `security.md`.
