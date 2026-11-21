# 2026-11-21 — CRB-01 Chevron de la pastille de série — in_review
Fait : sur l'Agenda au téléphone (390 px), le chevron de « N jours de suite » ne passe plus seul à la ligne (`.ag-streak__go` en ligne, pastille sans coupure). Remarque de Design relayée par Chiffres.
Pas fait : rien.
Décisions : la cause est le svg rendu en bloc par les styles de base, pas la largeur ; `nowrap` en plus pour qu'une largeur étroite ne coupe pas la pastille.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, `pnpm test` (pre-push), rendu à 390 px avant et après (lot `recette/2026-11-21/serie-chevron-1`).
