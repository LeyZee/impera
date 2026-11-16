# 2026-11-16 — CRB-01 Son jeu sur sa fiche, côté agence (PR C) — in_review
Fait :
- bloc « Jeu » en lecture sous Créatrices › sa fiche › Agenda (`CreatorGameBlock`, `useCreatorTrophyCase`) : ses deux séries avec la meilleure, sa plus haute médaille, ses trophées gagnés.
Pas fait : rien de la fiche.
Décisions :
- le bloc va sur l'onglet Agenda, le seul que le propriétaire et un manager actif ouvrent tous les deux, comme le veut l'ADR 0107 § 12 ;
- même gabarit que « Jeu » sur la fiche d'un chatteur ;
- aucun dévoilement marqué vu.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, `pnpm test`, captures du lot trophees-creatrice-fiche-c.
