# 2026-11-26 — Paie : « J'ai été décisif sur une vente » (trou 15) — in_review
Fait : le chatteur signale un de ses shifts finis des 15 derniers jours avec une note ; le signalement attend dans « Signalements de chatteurs » au-dessus de « Ventes en attente » ; le propriétaire ou un manager qui n'est pas son membre répond « Réglé » ou « Pas retenu » avec un mot ; le membre peut le retirer. ADR 0101 amendée, migration 0272, routes, écrans, glossaire, README de la paie, fiche EQ-25.
Pas fait : la notification sur le téléphone (avec celles de la paie).
Décisions : Charles, 21/11/2026, trou 15. Le compteur des signalements est en tête de leur propre panneau, pas mêlé à celui des ventes. « Voir les ventes de ce shift » ouvre le jour, chaque vente y porte son compte.
Découvertes : la base refuse de clôturer une quinzaine qui n'est pas finie ; le test de quinzaine clôturée écrit sa clôture en coupant le déclencheur, comme propriétaire des tables.
Candidats à suppression : aucun.
Vérifié : intégration des signalements 8/8 ✓ ; écrans 4/4 ✓ ; textes 3/3 ✓ ; Commissions et Quinzaine 83/83 ✓ ; typecheck et lint des fichiers touchés ✓.
