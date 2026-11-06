# 2026-11-06 — SC-03 b, le numéro de script sans trou — done

Fait : migration 0128, `content_drops.script_number` (contrôle : script seulement, à partir de 1 ; index unique par créatrice) ; les politiques `creator_insert` et `team_insert` refusent une ligne qui en porte un, et aucun droit de colonne ne permet de l'écrire. « Envoyer le script » le donne : verrou sur la ligne `creators` de la créatrice, puis un de plus que son dernier, inscrit au journal d'audit. Tests d'intégration : son premier script reçoit 1, gardé quand l'appui est rejoué ; deux scripts envoyés en même temps reçoivent 2 et 3.
Pas fait : le moment d'une structure « les deux » (en attente de Charles) ; cartons PNG, export ZIP et fiche à recopier (lot c).
Décisions : le numéro est donné à l'envoi, pas au début du remplissage, pour qu'un script commencé puis retiré ne laisse pas de trou ; un script retiré après l'envoi garde le sien.
Découvertes : `drizzle-kit generate` nomme la migration d'après l'index du journal (0112), pas d'après le dernier fichier, et réécrit le snapshot de ce numéro : renommer la migration et le snapshot, et restaurer l'ancien.
