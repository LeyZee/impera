# 2026-11-17 — Alertes par créatrice, ADR 0150 et lot 1 (base, contrat, routes) — in progress
Fait : ADR 0150 écrite et acceptée par Charles (« ok alertes »). Lot 1 : contrat `creator-alerts.ts` (alertes, familles, rôles, modes, défauts, verrou), table `creator_alert_routes` (migration 0222, RLS forcée, fermée à la créatrice, verrou en base), routes `GET` et `PUT /v1/creators/:creatorId/alerts` dans le module `alerts` (propriétaire seul, audit), tests unitaires et d'intégration, glossaire (Alertes d'une créatrice, Sourdine, Chatteur en shift).
Pas fait : lot 2 (le routeur qui lit l'outbox et appelle `notify`, raison `creator_alert`), lot 3 (`scripts_exhausted` et `offer_proposed`, fil Agent), lot 4 (l'onglet et les notifications de la créatrice par sorte, fil Design).
Décisions : l'onglet est du propriétaire seul (ADR 0149) ; « offre proposée » = tout ce qui se vend hors des scripts, venant de l'IA ou du fan (Charles, 17/11 13 h 35).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires ✓ ; tests d'intégration laissés à la CI (pas de Docker dans la session).
