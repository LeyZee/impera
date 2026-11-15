# 2026-11-14 — OPS-14 Les lectures de connectors pour le MCP — review
Fait : `ConnectorsModule.reads` (ventes, ventes par chatteur, relevés quotidiens, équipe importée), sous `withTenantMember` de la personne, bornées par les créatrices demandées ; ni part d'agence ni part de créatrice (schémas stricts) ; l'équipe importée est lue dans la base, sans appel à la plateforme.
Pas fait : les outils MCP qui s'en servent (fil MCP).
Décisions : une créatrice refusée refuse tout l'appel ; période de 93 jours au plus ; le panneau des ventes de supervision reste tel quel (accord de la coordination).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests unitaires ; intégration en CI.
