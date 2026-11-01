# 2026-10-27 — Drapeaux du fan : la créatrice ne les lit plus (ADR 0023) — done

Fait : `GET /v1/fans/:id/flags` n'accepte plus le rôle `creator` : propriétaire et chatteurs seulement, comme le `PUT`. Une créatrice ne voit jamais les données de ses fans (ADR 0023). Test d'intégration : la créatrice reçoit 403 en lecture comme en écriture.

Pas fait : les routes de `conversations` (Bilan, PR à part).

Décisions : aucune.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `apps/api` contre Postgres 16.
