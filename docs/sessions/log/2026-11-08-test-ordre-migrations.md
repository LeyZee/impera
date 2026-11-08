# 2026-11-08 · Test de l'ordre des migrations

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : action 3 du bilan projet (`docs/bilans/2026-11-08-bilan-projet.md`, R4), « test ordre migrations »

- Fait : `packages/db/src/migrations-order.test.ts`. Le test refuse un journal dont les numéros ou les `when` ne sont pas strictement croissants, un fichier SQL sans entrée (ou l'inverse), un snapshot manquant ou dont le `prevId` ne suit pas, et un plus grand snapshot qui n'est pas celui de la dernière entrée. Vérifié en abaissant à la main le `when` de la dernière entrée : le test échoue avec le message attendu.
- README de `packages/db` : section « Numéros de migration entre fils ».
- Découvertes : le snapshot de 0124 (`password_reset_links`, #581) n'a jamais été commité. 0125 pointe vers un `prevId` absent. C'est une exception nommée dans le test.
