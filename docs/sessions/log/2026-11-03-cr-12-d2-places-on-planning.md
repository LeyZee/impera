# 2026-11-03 — CR-12 lot d2 : « à pourvoir » en places sur Équipe › Planning — done
Fait : `slotRowOf` lit les places de chaque créneau (`seatsOf`) et compte ce qui manque (`places`), comme `slotsToFill` du serveur ; « IA seule » réservée à une place unique ; coin en places ; demi-cartes empilées, « + 2e chatteur » et « À pourvoir · 2 places » (texte et lecteur d'écran) ; sur téléphone, la cellule du jour passe en colonne flexible (la sous-grille y retombait sur des lignes fixes et le créneau débordait). Tests : modèle (places comme le serveur), page (décompte en places, jamais « IA seule » sur un créneau à deux places).
Décisions : le coin compte des places et non des créneaux ; une place libre sous un chatteur se dit « + 2e chatteur », deux places vides « À pourvoir · 2 places ».
Pas fait : Mois et « L'équipe » du chatteur encore en créneaux ; renforts (CR-13).
Découvertes : aucune.
