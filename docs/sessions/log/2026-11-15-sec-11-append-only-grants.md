# 2026-11-15 — SEC-11 Droits des tables en ajout seul et journaux de la bibliothèque d'authentification — done
Fait : migration 0210 (`nirvana_app` sans `UPDATE`, `DELETE` ni `TRUNCATE` sur `audit_log`, `conversation_events`, `domain_events`, `platform_sales`) ; `append-only.integration.test.ts` (catalogue : toute table à trigger `*_append_only`, pour les deux rôles) ; `authLibraryLogFrom` (les lignes de Better Auth passent par pino et ses sérialiseurs) et son test dans `session-database-outage.integration.test.ts` ; `data-model.md`, `security.md`, `coding.md`.
Pas fait : rien.
Décisions : aucune.
Découvertes : la base des tests ne pose pas les privilèges par défaut de `init.sql`, donc une table dont la migration accorde sans retirer n'a pas les mêmes droits en test et sur une base réelle (vu sur `platform_sales`) ; à poser dans `global-setup.ts` par le fil Bilan pour que le catalogue des tests soit celui de la production ; `mcp/application/__tests__/content-tools.test.ts` échoue au hasard quand un identifiant tiré contient « 1500 », le prix que le test cherche dans la sortie (fil MCP).
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, suites d'intégration de `packages/db` et de `apps/api` ✓ sur un Postgres local (les deux fichiers qui demandent un stockage objet en conteneur ne tournent qu'en CI).
