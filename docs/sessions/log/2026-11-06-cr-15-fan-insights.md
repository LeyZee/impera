# 2026-11-06 · CR-15 : « Qui sont tes fans » dans Ventes

- Fil : Insights fans. Branche `claude/project-thread-13mcjw`.
- Fait : rangement pur dans `fans/domain/figures.ts` (âge en chiffres ou en lettres, région ou pays, 14 familles de métiers, 4 situations, parts au plus fort reste, top 5 et « Autres ») ; contrat `CreatorFanInsightsSchema` strict ; `GET /v1/creator-space/fan-insights` sous `withCreatorAccount`, chiffres arrêtés à minuit dans le fuseau de la créatrice ; panneau « Qui sont tes fans » en tête de Ventes (anneaux, barres, carte d'activité 7 × 8, survol et toucher, mouvement réduit, Nuit et Jour, téléphone).
- Pas fait : validation des captures par Charles, relectures Bilan et Extension.
- Décisions : aucune hors ADR 0074 ; les trois compteurs du haut arrondis à la dizaine et « moins de 10 » sous le seuil (§ 8, relevé au lot a des captures) ; palette violet agent et vert, jamais de rouge (réservé aux urgences).
- Découvertes : sur téléphone, le panneau est long avant la liste des fans ; à revoir si Charles le trouve gênant.
- Candidats à suppression : aucun.
- Vérifié : pnpm check, tests unitaires (91 sur le rangement, 15 web), intégration fan-insights (4) et harnais d'isolation.
