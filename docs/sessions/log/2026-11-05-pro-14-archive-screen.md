# 2026-11-05 · PRO-14 c : archiver et rouvrir depuis Créatrices

- Fiche : recette du 05/11, PRO-14 et reco 23 ; ADR 0071 § 2.
- Fait :
  - Créatrices › Profil gagne « L’archiver » : une confirmation dit ce qui change (agent arrêté, espace fermé) et ce qui reste (conversations, ventes, paies, scripts) ;
  - le mot de passe est redemandé après 10 minutes ;
  - un refus dit combien de shifts la retiennent encore ;
  - en pied de page, le propriétaire voit une liste repliée « Archivées », avec la date et « Rouvrir ». Rouverte, la créatrice redevient la fiche ouverte, et un message rappelle que son agent reste à l’arrêt et qu’un nouveau lien rouvre son espace ;
  - le lecteur de Suivi explique le refus `creator_archived_conflict`.
- Tests : `ArchivePanel.test.tsx`, `ArchivedCreators.test.tsx`, `reader-model.test.ts`.
- Découvertes : aucune.
