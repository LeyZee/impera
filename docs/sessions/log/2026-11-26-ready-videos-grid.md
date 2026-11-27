# 2026-11-26 — Grille sur mesure : les vidéos déjà tournées (ADR 0159 § C) — done
Fait : liste `readyVideos` dans la grille (`ReadyVideoLineSchema`, identifiant `rv_` et huit chiffres hexadécimaux, fourchette d'au moins 1 €, interrupteur « En vente », au plus 40 types, noms uniques), lue vide sur une grille enregistrée avant (pas de migration) ; tirage pur `readyVideoPriceMinor(line, seed)` arrondi à l'euro dans la fourchette ; carte « Vidéos déjà tournées » dans Créatrices › Scripts › Sur mesure (type nommé par le propriétaire, « De », « À », « En vente », « Retirer ») ; ADR 0159, glossaire.
Pas fait : le rattachement d'une vidéo déposée à son type et le moment du tirage (fil Coffre, `sale_video.readyVideoId`).
Décisions : aucun nom de type dans le dépôt, Charles crée ses lignes ; le prix d'une vidéo est tiré une fois puis gardé, le tirage ne dit pas quand.
Découvertes : quand l’agent lira ces noms saisis par le propriétaire, les passer en bloc délimité comme les suppléments, et figer le prix tiré au moment de l’offre côté serveur (Sécurité, 26/11).
Candidats à suppression : aucun.
Vérifié : tests du contrat (lecture d'une ancienne grille, refus, tirage), du modèle et de la section web ; intégration `custom-prices` ; `pnpm check`.
