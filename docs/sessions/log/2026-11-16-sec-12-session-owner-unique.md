# 2026-11-16 — SEC-12 Une identité de plateforme n'appartient qu'à un compte — done
Fait : migration 0213 (`platform_accounts.session_owner`, unique par plateforme) ; `storeSession` l'écrit et rend `SessionOwnerConflict` sur la contrainte ; `sessions.ts` refuse une session que le relevé des ventes lie à un autre compte ; test d'intégration ; `data-model.md`, README de `connectors`. Après relecture de Bilan : le compte d'une créatrice archivée rend l'identité au compte qui la synchronise, avec sa ligne d'audit.
Pas fait : le popup de l'extension (fil Extension).
Décisions : aucune.
Découvertes : un compte synchronisé avant la migration n'a son identité qu'à sa « Sync » suivante ; un refus de « Sync » n'entre pas au journal d'audit (la transaction est annulée), à voir par Bilan.
Candidats à suppression : aucun.
Vérifié : voir la PR.
