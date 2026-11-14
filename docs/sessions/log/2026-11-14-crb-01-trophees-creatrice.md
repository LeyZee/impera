# 2026-11-14 — CRB-01 Trophées de la créatrice, lot 1 — in_review
Fait : domaine pur (médailles de série 7/14/30/50/100 sur sa meilleure série, série de livraisons, neuf trophées, vitrine au format commun) ; lectures `creatorDaysForGameUnscoped` (agenda) et `dropsForGameUnscoped` (dépôts, arrivée lue sur l'événement `content_drop_received`, seuls les dépôts de son compte) ; le job `rewards.evaluate` constate aussi ses gains ; routes `GET /v1/creator-space/trophy-case`, `POST …/reveals` (elle), `GET /v1/creators/:creatorId/trophy-case` (propriétaire, manager actif qui l'a sur sa liste) ; migration 0202 (types de la créatrice sur `reward_gains_kind_check`) ; écrans : médaille à côté de sa série (Aujourd'hui, Agenda), dévoilement (trois d'affilée au plus), symboles de la planche 3 dans `creator-art.tsx`.
Pas fait : le job lancé juste après une coche et un dépôt (il passe toutes les 10 minutes) ; l'écran de la fiche côté agence ; « Stock plein » et « Contenu qui a cartonné » attendent leurs signaux (stock non calculé, « à refaire » absent) ; la vitrine est au fil de l'ADR 0108.
Décisions : aucune nouvelle ; numéro de migration 0202 provisoire (coordinateur).
Découvertes : le stock de l'ADR 0055 § 5 n'est calculé nulle part dans le code.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test, pnpm test:integration en local ; captures lot trophees-creatrice-1.
