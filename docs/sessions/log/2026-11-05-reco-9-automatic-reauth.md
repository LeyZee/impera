# 2026-11-05 — Reco 9 : l'Automatique redemande le mot de passe et le code

Fait : passer en Automatique, pour toute une créatrice (`PUT /v1/agent/mode`) ou pour une conversation (`POST /v1/conversations/:id/mode`), exige une ré-authentification de moins de 10 minutes (`requireRecentLogin`), sinon 403 `reauthentication_forbidden`. Arrêt et Copilote ne demandent rien, pour qu'un arrêt d'urgence reste immédiat (`message-flow.md`).
Pas fait : la fenêtre qui redemande le mot de passe et le code dans le contrôle du mode, côté écran (Extension).
Décisions : la ré-authentification est vérifiée une fois le corps validé, seulement quand le mode demandé est `auto` ; le verrou de l'ADR 0019 reste vérifié en plus.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `agent-mode.integration.test.ts` (Automatique refusé sans ré-authentification récente, Arrêt et Copilote acceptés), suites `conversation*`.
