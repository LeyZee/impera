# 2026-11-21 — EQ-24 « Où te verser » — in_review

Fait : le membre écrit où le verser (mobile money, compte bancaire, retrait en espèces) dans Moi › Dossier ; le propriétaire le lit à côté de « Marquer payé », révèle le numéro un membre à la fois avec connexion récente. Bloc scellé, table en ajout seul fermée au rôle de service, notification au membre à chaque changement, re-scellement par ajout d'une version.
Pas fait : l'espace de départ (EQ-14) ; captures et avis de Design.
Décisions : ADR 0165 proposée, droits revus par Sécurité le 21/11 (aucun GRANT au rôle de service, contexte membre et version, révélation journalisée, `no-store`, 3 changements par jour). Le journal garde la version écrite plutôt qu'une empreinte : le registre refuse les champs `fingerprint` et `hash`.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, tests unitaires (contracts, api, web), intégration `payout-destinations`, `key-check`, `service-role`.
