# 2026-10-27 — Écarts méthode / code : offres, budget nul, remise — done

Fait : `offerDecision` décide maintenant de chaque offre du cerveau dans `composeTurn`, pour un vrai fan, le playground et les évals ; refusée, la voix reçoit une réponse sans rien à vendre. Un fan qui dit ne pas pouvoir payer est gelé (`salesFrozen`, raison `money_trouble`) par la politique, sans écraser un gel posé par un humain ; s'il n'est pas enregistré, un humain répond. Nouvelle garde bloquante `discount` (remise, petit prix, négociation).

Pas fait : le curseur de sexualisation, le minimum de KYC, l'âge avant l'explicite et les relances, en fiches proposées (`P3-09-sexualization-cursor.md`, `P3-10-follow-ups.md`).

Décisions : sans historique des offres (P6-01), l'agent réel ne propose rien (fail closed). Un gel pour manque d'argent se lève, offre par offre, quand il revient de lui-même au payant.

Découvertes : seul un humain pose `ageConfirmedAt` ; le libellé de la garde `discount` manque dans `apps/web/src/screens/tracking/reader-model.ts` (zone Extension).

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration agent et fans sur Postgres 16 local.
