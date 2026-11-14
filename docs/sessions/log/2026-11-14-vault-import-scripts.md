# 2026-11-14 — Coffre Reveal : importer les scripts natifs — in_progress
Fait : tables `platform_scripts`, `platform_script_steps`, `platform_script_step_media` (migration 0201 provisoire, FORCE RLS, `nirvana_app` en lecture, écritures en rôle de service) ; plan d'import par empreinte (ajouté, changé ou revenu, inchangé, disparu désactivé jamais supprimé) ; avertissements de prix (plus du double, au-dessus de 40 € TTC) ; place de chaque média au coffre et « proposable » ; lectures de l'agence et lecture d'un script hors personne pour la récompense du jeu des cœurs (ADR 0111) ; scénario FakeReveal `sequence_removed`.
Pas fait : branchement du job horaire sur la lecture des scripts de `connectors` et sur `media_platform_refs` (attend la PR de la synchronisation du coffre) ; écran (fiche séparée).
Décisions : avertissements calculés à la lecture, rien de stocké ; un script disparu garde ses étapes ; aucun script natif proposable avant l'identité c8.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : typecheck, lint, tests unitaires du domaine, `platform-scripts.integration.test.ts` (6 tests).
