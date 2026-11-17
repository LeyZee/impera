# 2026-11-16 — CRB-01 Recette du 16/11, mineures de la créatrice — in_review
Fait : CRE-06 (job `rewards.evaluate_creator` après une coche ou un dépôt arrivé, relecture de sa vitrine à 4 s et 12 s), créatrice archivée hors de `players()`, CRE-13 (pastille de série en lien vers Mes trophées, médaille nommée), CHT-10 et CRE-18 (carillon après un geste), CRE-14 (unité `once`, « Encore 5 »), CRE-15, CRE-17 (trophées sans signal cachés), bandeau d'un jour à venir, routine retirée due le jour même (`removedAt`, choix de Charles).
Pas fait : PR C (sa vitrine sur sa fiche côté agence).
Décisions : le job est demandé par SQL dans les modules qui voient le geste, comme `creator_tasks.suggestion_decided` (les frontières interdisent d'importer `rewards`) ; un trophée d'un geste vaut 0 sur 1 en unité `once`, que la vitrine ne dessine pas (accord Vitrine) ; « Stock plein » est caché comme « Contenu qui a cartonné », faute de signal lui aussi.
Découvertes : avant ce lot, retirer une routine essentielle le jour même vidait la journée et sauvait la série.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, `pnpm test`, `pnpm test:integration`.
