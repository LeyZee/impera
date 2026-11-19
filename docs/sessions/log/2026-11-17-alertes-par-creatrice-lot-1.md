# 2026-11-17 — Alertes par créatrice, ADR 0150 et lot 1 (base, contrat, routes) — in progress
Fait : ADR 0150 écrite et acceptée par Charles (« ok alertes »). Lot 1 : contrat `creator-alerts.ts` (alertes, familles, rôles, modes, défauts, verrou), table `creator_alert_routes` (migration 0222, RLS forcée, fermée à la créatrice, verrou en base), routes `GET` et `PUT /v1/creators/:creatorId/alerts` dans le module `alerts` (propriétaire seul, audit), tests unitaires et d'intégration, glossaire (Alertes d'une créatrice, Sourdine, Chatteur en shift).
Fait le 19/11 (lot 2) : le routeur `alerts.route` (chaque minute, fenêtre d'une demi-heure, clé = l'événement), la raison `creator_alert` dans la même migration, `silent` dans la notification push et le service worker pour la sourdine ; relecture Sécurité : manager refusé testé, audit seulement sur un vrai changement, verrou relu par le routeur et défauts sur une lecture en échec.
Pas fait : lot 3 (`scripts_exhausted` et `offer_proposed`, fil Agent), lot 4 (l'onglet et les notifications de la créatrice par sorte, fil Design).
Décisions : l'onglet est du propriétaire seul (ADR 0149) ; « offre proposée » = tout ce qui se vend hors des scripts, venant de l'IA ou du fan (Charles, 17/11 13 h 35).
Découvertes : la table `notifications` de supervision (la « cloche » de l'ADR 0020) n'est lue par aucun écran ; la sourdine passe donc par une notification sans son.
Candidats à suppression : aucun.
Vérifié : tests unitaires ✓ ; tests d'intégration laissés à la CI (pas de Docker dans la session).
