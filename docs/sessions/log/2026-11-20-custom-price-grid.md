# 2026-11-20 — Grille de prix sur mesure dans le CRM (ADR 0159 § C) — done
Fait : contrats `custom-prices` (formats, suppléments, calcul `quoteCustomOrder`) ; table versionnée `custom_price_grids` (migration 0236, RLS forcée, lecture et insertion par le propriétaire seul sous la RLS, lecture seule pour `impera_service`) ; module `custom-orders` (lecture et enregistrement, conflit de version 409, rejeu idempotent, journal d'audit sans prix) ; écran « Sur mesure » (Formats, Suppléments, Calculateur) ; glossaire (Grille sur mesure, Supplément).
Pas fait : la commande elle-même (états, carte à la créatrice, acompte) suit le calendrier de l'ADR ; l'écran est un onglet provisoire de la fiche, à déplacer en vue de l'onglet Scripts après la PR de navigation de Design.
Décisions : ADR 0159 (feu vert de Charles pour coder l'écran, 20/11 15 h 50).
Découvertes : le préfixe de classes `cp-` est déjà pris par l'écran « Canal » ; rien ne vérifie l'unicité des préfixes CSS entre écrans.
Candidats à suppression : aucun.
Vérifié : tests unitaires contrats et web, intégration Postgres (RLS, routes, balayages d'authentification et d'origine), captures Nuit/Jour PC/téléphone avec prix de test neutres.
