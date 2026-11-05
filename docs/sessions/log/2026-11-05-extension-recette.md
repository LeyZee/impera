# 2026-11-05 — Recette du 05/11 : constats de l'extension (MOT-09, CREA-13, PRO-24) — done
Fait : le popup sépare un CRM dont l'API est arrêtée (502, 503, 504 : « Le serveur ne répond pas », bouton Réessayer seul, pastille « Indisponible ») d'une adresse sans réponse (« Le CRM ne répond pas », inchangé) (MOT-09) ; `/aide/extension` renvoie la créatrice vers sa première page avec « Cette page n'est pas dans ton espace. », comme toute page qui n'est pas la sienne (CREA-13, ADR 0067 § 2) ; le guide ne montre plus que ce que l'extension fait aujourd'hui, et ce qui viendra tient en une ligne en pied de page, avec la veille seulement pour le propriétaire et les managers (PRO-24, partie guide).
Pas fait : la phrase « Ventes : bientôt lues depuis Reveal » du Dashboard (PRO-24, partie Dashboard), hors de ce fil.
Décisions : seules 502, 503 et 504 valent « serveur arrêté » (ce que répondent Vite et nginx quand l'API derrière eux ne répond pas) ; une 500 reste « injoignable ».
Vérifié : tests de session (502, 503, 504) et de l'écran du popup ; App.test (créatrice renvoyée, chatteur servi) ; tests du guide ; captures popup et guide, Nuit et Jour : `/mnt/project-files/extension/recette-2026-11-05/`.
Découvertes : aucune.
Candidats à suppression : aucun.
