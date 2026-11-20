# 2026-11-20 — Suites de l'extension après l'adresse intégrée — done
Fait : un 429 du CRM (trop d'essais d'un coup) n'est plus lu « le CRM ne répond pas » : la carte Reveal et la liaison disent d'attendre une minute, et un lot de relevés refusé ainsi est gardé pour l'envoi suivant ; l'image `web` reçoit aussi `WEB_ORIGIN`, et le build de l'extension échoue si l'adresse intégrée nomme un autre site (avis Sécurité et Bilan du 20/11) ; Entraîner et Réglages ont leurs propres icônes de raccourci, celles du menu du CRM (avis Design du 19/11).
Pas fait : rien dans le périmètre.
Décisions : aucune nouvelle.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests extension ✓, build de l'extension avec deux adresses différentes refusé, identiques (barre finale près) accepté, interpolation compose vérifiée.
