# 2026-11-20 — Tenue de départ dans la description d'un média déposé — done
Fait : vocabulaire des descriptions en 1.1.0 ; un média qu'elle dépose (coffre Reveal compris) est décrit avec sa tenue au départ (`outfit` : allure, pièces et une à trois couleurs, listes fermées) ; prompt `sense/creator-drop` 1.2.0 ; la vision doit la donner, une description 1.0.0 reste valide sans elle ; avenant de l'ADR 0083 § 2, vocabulaire documenté, terme « Tenue de départ » au glossaire.
Pas fait : l'usage de la tenue par l'IA de chatting (teaser d'un média verrouillé, choix selon les goûts d'un fan, cadeaux) et son affichage à l'écran ; la redescription des médias déjà décrits, qui attend l'accord de Charles (nombre et coût).
Décisions : avenant ADR 0083 § 2 (choix de Charles du 20/11) ; le moment jour, nuit ou polyvalent reste hors de la description.
Découvertes : la clé de cache des médias de conversation porte la version du vocabulaire : un média de fan revu après la fusion est décrit une fois de plus.
Candidats à suppression : aucun.
Vérifié : tests contrats ✓, passerelle ✓ (120), API unitaires ✓, intégration coffre et scripts ✓.
