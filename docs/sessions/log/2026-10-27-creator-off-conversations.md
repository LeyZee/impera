# 2026-10-27 — Conversations fermées au rôle creator — done
Fait : les quatre lectures de `/v1/conversations` (liste, détail, messages, événements) n’acceptent plus que `owner` et `operator` ; une créatrice reçoit 403 `role_forbidden`, même sur ses propres conversations (ADR 0023). Test d’intégration sur les quatre routes ; `docs/conventions/api.md` le dit.
Pas fait : la fermeture de Suivi côté interface (PR #168 du fil Extension, fusionnée avec celle-ci).
Décisions : `role_forbidden` plutôt que `creator_forbidden` : ce n’est pas une créatrice hors périmètre, c’est le rôle qui n’y a pas droit.
Découvertes : `GET /v1/dashboard` (supervision) accepte `creator` et renvoie « À traiter » et les meilleurs fans avec leur nom : même règle de l’ADR 0023 à appliquer par le propriétaire du module.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, intégration `conversations-http` (8 tests).
