# 2026-11-20 — Tenue de départ dans la description d'un média déposé — done
Fait : vocabulaire des descriptions en 1.1.0 ; un média qu'elle dépose (coffre Reveal compris) est décrit avec sa tenue au départ (`outfit` : allure, pièces et une à trois couleurs, listes fermées) ; prompt `sense/creator-drop` 1.2.0 ; la vision doit la donner, une description 1.0.0 reste valide sans elle ; avenant de l'ADR 0083 § 2, vocabulaire documenté, terme « Tenue de départ » au glossaire.
Pas fait : l'usage de la tenue par l'IA de chatting (teaser d'un média verrouillé, choix selon les goûts d'un fan, cadeaux) et son affichage à l'écran ; la redescription des médias déjà décrits, qui attend l'accord de Charles (nombre et coût).
Décisions : avenant ADR 0083 § 2 (choix de Charles du 20/11) ; le moment jour, nuit ou polyvalent reste hors de la description.
Découvertes : une description écrite ou revue à la main, ou celle d'un média du coffre posée par le code, est marquée 1.1.0 même sans tenue (relecture Bilan) : « tenue absente » vaut alors inconnu, comme en 1.0.0. La clé de cache des médias de conversation porte la version du vocabulaire : un média de fan revu après la fusion est décrit une fois de plus.
Candidats à suppression : aucun.
Vérifié : tests contrats ✓, passerelle ✓ (120), API unitaires ✓, intégration coffre et scripts ✓.
