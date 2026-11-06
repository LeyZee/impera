# 2026-11-06 · recette MOT-13 : les refus de clé et de jeton dans l'enveloppe d'erreur commune

- Fil : Bilan. Branche `claude/project-thread-a8l1w6`.
- Fait : les refus `{ kind, message }` des Réglages (clé d'un service IA, clé et webhook du flux de ventes, jeton et test Telegram, conflit de version des routes Telegram, refus de la plateforme à la vérification de fiabilité) sortent désormais dans `{ error: { code, message, details: { kind }, requestId } }`. `RefusalError`, `refusalBodySchema` et `refusalOf` dans `packages/contracts/src/errors.ts` ; nouveau suffixe `*_bad_gateway` → 502 pour la vérification. Les trois écrans lisent la nouvelle forme ; la phrase montrée ne change pas.
- Tests : contrats (`errors.test.ts`), routes des services IA, `server.test.ts` (502), intégration `providers`, `telegram`, `sales-feed*` en local ; tests web des trois écrans adaptés.
- Décisions : un code par groupe de routes plutôt qu'un `credential_unprocessable` unique ; la nature reste dans `details.kind`, sans changer les statuts (422, 409, 502).
- Découvertes : aucune.
