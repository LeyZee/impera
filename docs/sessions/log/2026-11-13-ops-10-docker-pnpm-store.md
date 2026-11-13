# 2026-11-13 — OPS-10 Les images Docker ne se disputent plus le cache pnpm — done
Fait : `sharing=locked` sur les montages du cache pnpm des Dockerfiles de l'API et du web, `--prefer-offline` au lieu de `--offline`.
Pas fait : rien.
Décisions : aucune.
Découvertes : compose construit migrate, api et worker à partir de la même image ; la construire une fois accélérerait le job.
Candidats à suppression : aucun.
Vérifié : `pnpm check` (check-repo, prettier) et le job « Docker images » de la PR.
