# 2026-11-03 — ADR 0069 : import des créatrices depuis Reveal — accepted
Fait : lecture de ce que l'API CRM expose (`/v1/models`, ventes, chiffres, chatteurs) et de l'existant (`listModels`, `sales_feed_models`, lien automatique par pseudo, ventes mises de côté) ; ADR 0069 (revue du propriétaire avant création, jamais de persona, de pourcentage ni d'agent remplis).
Pas fait : aucun code.
Décisions : Charles, 03/11 19 h 34 (demande) ; 19 h 45 « go import » (écrire l'ADR sur la proposition de revue) ; 19 h 58 « ok 0069 » ; fiche CRM-07 (lots a Bilan, b Extension).
Découvertes : `PlatformModel` ne porte ni `status` ni `avatarUrl` aujourd'hui.
Vérifié : pnpm check (voir la PR).
