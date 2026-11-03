# 2026-11-03 — CR-12 : palette de 12 nuances des membres — done
Fait : `MEMBER_PALETTE` (douze nuances nommées) et `shadeOf` ; « Couleur du planning » dans « Modifier » devient douze pastilles en boutons radio, la choisie entourée et cochée, son nom dessous ; une couleur d'avant la palette reste en tête, « Couleur actuelle ». Tests : palette contre `tokens.css` (12 nuances distinctes, contraste 3:1 en Nuit et Jour sur la surface relevée et le fond, 30° de teinte loin du rouge, des urgences, de l'ambre et du violet de l'IA), page (choix envoyé seul, couleur ancienne gardée sans envoi).
Décisions : une valeur pour les deux thèmes, tirée en OKLCH à luminance visée ; le serveur accepte toujours toute couleur `#rrggbb` (les couleurs enregistrées restent valides) ; pas de couleur par défaut à l'ajout d'un membre.
Pas fait : nuances déjà prises marquées, nuance libre par défaut à l'ajout, écart minimal entre deux nuances (relecture d'Extension).
Découvertes : aucune.
