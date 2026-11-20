# 2026-11-20 — SEC-17 Durée d'une session selon le rôle — in progress

Fait : `apps/api/src/session-lifetime.ts` (12 h, 48 h, 7 jours, `LONG_IDLE_ROLES` = propriétaire et créatrice (décision de Charles du 20/11), rôle inconnu en durée courte) ; `expiresIn` de Better Auth à 48 h ; crochet `session.update.before` qui refuse et supprime la prolongation d'une session finie ; `sessionOf` vérifie l'inactivité selon le rôle en plus des 7 jours ; cookie renouvelé avec la session (`requireRole`, `GET /v1/session`) ; Réglages › Sécurité ne liste et ne compte que les sessions vivantes ; `security.md` § 6. Tests : unitaire (5), intégration (8, écrits et typés).
Reste : fusion de #917 à son tour.
Décisions : ADR 0160 (acceptée, « ok sessions ») ; la créatrice passe à la durée longue (Charles, 20/11, 19 h 17).
Découvertes : Better Auth prolonge une session avant de la rendre (`updated_at` à maintenant), une vérification après coup ne voit jamais l'inactivité ; et `auth.api.getSession` jetait le `Set-Cookie` de la prolongation, si bien que le navigateur oubliait toute session 12 h après la connexion, même utilisée. Une connexion envoyée avec `rememberMe: false` n'est jamais prolongée par Better Auth (24 h au plus, son cookie meurt avec le navigateur) : `sessionOf` la ferme 12 h après la connexion pour un rôle court, c'est le plus sûr.
Candidats à suppression : aucun.
Vérifié : prettier ✓, eslint ✓, `tsc --noEmit` (api) ✓, `pnpm --filter ./apps/api test` ✓ (3047 tests, dont les 5 nouveaux), `node scripts/check-repo.mjs` ✓ ; intégration `session-lifetime` 8/8 sur Postgres 16.
