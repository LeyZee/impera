# 2026-11-14 — OPS-13 L'essai de restauration connaît les rôles de l'ADR 0087 — done
Fait : `restore-check.sh` crée `nirvana_admin` sans connexion s'il manque ; `restore.md` § C étape 4 donne une connexion à `nirvana_app` et `impera_service` dans le conteneur jetable et branche l'API sur les trois rôles.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check` et le job « Docker images » de la PR.
