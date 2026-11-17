# 2026-11-16 — SEC-13 Une « Sync » refusée laisse sa ligne au journal d'audit — done
Fait : `recordRefusedSession` (`connector.session_refused` : compte, motif, utilisateur), appelée par `sessions.ts` hors de la transaction refusée ; assertions dans `connectors.integration.test.ts` ; README de `connectors`.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
