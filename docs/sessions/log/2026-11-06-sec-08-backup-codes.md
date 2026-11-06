# 2026-11-06 · recette SEC-08 : codes de secours sans casse ni caractères ambigus

- Fil : Bilan. Branche `claude/project-thread-a8l1w6`.
- Fait : les codes de secours sont tirés en base 32 de Crockford (`XXXXX-XXXXX`, sans I, L, O ni U ; `apps/api/src/backup-codes.ts`, `customBackupCodesGenerate`). Le code saisi est normalisé dans `SecondFactorCodeSchema` (majuscules, O → 0, I et L → 1, `normalizeBackupCode`). Les codes gardés le sont aussi à la lecture : `storeBackupCodes` chiffre et déchiffre avec le secret de Better Auth exactement comme son mode `'encrypted'`, puis normalise la liste. Les codes tirés avant restent donc bons, saisis dans n'importe quelle casse.
- Tests : contrats (`auth.test.ts`) ; intégration `second-factor` : alphabet, code saisi en minuscules accepté puis épuisé, ancien code à casse mêlée accepté en minuscules et avec O pour 0.
- Décisions : normaliser côté serveur plutôt que de compter sur l'écran ; la mise en majuscules à la saisie dans `CodeInput` reste un confort d'écran (Extension), sans effet sur l'acceptation.
- Découvertes : aucune.
