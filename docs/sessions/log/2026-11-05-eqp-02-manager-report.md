# 2026-11-05 — Recette EQP-02 : un manager fait son propre rapport — done

Fait :

- Équipe › Planning, fiche d'un shift du lecteur (un manager qui chatte) : la ligne « Rapport » offre « Faire mon rapport » dès que le shift en prend un (`opensAt` passé, tel que la liste des rapports le dit), puis, une fois envoyé, son montant et la pastille de son rapport dans ses mots (« En attente », « Renvoyé », « Validé »), qui le rouvre pour le reprendre ou le lire.
- Le panneau est celui d'Aujourd'hui et de Planning (`ReportPanel`) ; il se rouvre sur Équipe › Planning après « Annuler » ou un refus (`ReportScreen` gagne `/equipe/planning`).
- Le shift d'un autre membre, et tout shift pour le propriétaire, qui n'a pas de fiche de membre, gardent « Sans rapport » et le lien vers Rapports.

Pas fait : Moi › Planning et Moi › Commissions pour le manager (ADR 0024 § Moi). La lecture du planning, des congés, des échanges et des quinzaines rend tout à un manager : ces écrans demandent de filtrer ses seules lignes, ce qui sort de ce constat.

Décisions :
- le rapport se fait depuis la fiche du shift, comme la recette le propose, plutôt que par un nouvel écran : c'est là qu'un manager voit déjà son shift ;
- la pastille parle au membre (`MEMBER_STATUS`), pas à l'agence : c'est son rapport.

Découvertes :
- le Dashboard d'un manager ne lui rappelle pas un rapport à faire, alors qu'Aujourd'hui le fait pour un chatteur (`/v1/dashboard/todos`, Bilan) ;
- Moi › Planning et Moi › Commissions du manager, promis par l'ADR 0024, restent à faire, avec des lectures filtrées sur lui.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- unitaires web : `PlanningPage` (le manager fait son rapport depuis la fiche, le rouvre renvoyé ; le propriétaire garde « Sans rapport ») ;
- captures Nuit et Jour, téléphone et ordinateur : `recette/2026-11-05/corrections/equipe/eqp02/` dans les fichiers du projet.
