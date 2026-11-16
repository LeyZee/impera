# 2026-11-16 — DSH-04 Périodes du calendrier et comparaison choisie — in_progress
Fait : ADR 0146 (proposée) ; contrat, domaine et lecteur des jours du calendrier (jour, semaine, mois, personnalisé) avec comparaison choisie ; écran avec flèches, listes, courbe au survol et comparaison ; tests unitaires, d'intégration et d'écran.
Pas fait : captures de recette, acceptation de l'ADR, relectures Design et Bilan.
Décisions : une période en cours se compare sur autant de jours ; pas de pourcentage quand le registre commence après la période comparée.
Découvertes : Reveal compte chaque abonnement gratuit comme une vente (nombre de ventes et panier moyen différents d'Impera) ; ses vues modèle et agence ne sont pas recalculées à la même heure.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests unitaires supervision, MCP et dashboard ✓ ; intégration à faire tourner en CI (pas de Docker dans la session).
