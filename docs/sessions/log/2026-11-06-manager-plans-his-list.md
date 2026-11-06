# 2026-11-06 — Le planning d'un manager borné à sa liste (réponse de Charles du 06/11, découverte d'EQ-13)

Fait :
- Domaine : `plannedCreatorsOf` (le propriétaire planifie toutes les créatrices, un manager actif celles de sa liste) et `plansCreator`, testés.
- Infra : `plannedIn` lit la liste du manager dans la transaction, jamais dans la requête.
- Planning, modèles et « qui est en poste » ne montrent au manager que les créatrices qu'il planifie. Toutes restent lues pour les conflits : un membre occupé chez une autre barre toujours la route de ses modèles, par un identifiant qu'il ne peut pas ouvrir.
- Écritures hors de sa liste refusées comme si la ligne n'existait pas : poser un shift ou un modèle répond 404 `creator_not_found`, déplacer ou annuler un shift 404 `shift_not_found`, finir un modèle 404 `shift_template_not_found`.
- Calendrier (CR-12) : en vue `agency`, un manager ne lit que les créatrices de sa liste (créatrices, shifts, agent, comptes, créneaux à pourvoir, couverture).
- Harnais d'isolation (#588) : le manager de A ne finit plus le modèle de B. `AGENCY_SCOPE` perd cette ligne et `AGENCY_WRITES` est vide.
- Contrat (commentaires de `scheduling.ts` et `calendar.ts`), README du module, note dans EQ-02.

Pas fait :
- Les congés, les échanges entre chatteurs (dont l'annulation d'un échange par l'agence), les rapports et la paie restent à l'échelle de toute l'équipe, comme le dit l'ADR 0023. Un congé est celui d'un membre et n'a pas de créatrice (ADR 0031).

Décisions :
- Pas d'ADR. L'ADR 0023 dit déjà que « `creator_ids` borne leurs créatrices », et la réponse de Charles tranche entre ses deux lectures.
- 404 plutôt que 403 : le manager ne voit pas ces lignes, un refus ne doit pas lui apprendre qu'elles existent.
- La règle vit dans le code de `scheduling`, pas dans une politique de la base. Les politiques de l'équipe restent celles de l'ADR 0023, comme pour reco 10.

Découvertes :
- Un manager peut encore annuler un échange accepté entre deux chatteurs chez une créatrice hors de sa liste. C'est un geste rare, et le borner toucherait aux échanges qui traversent deux créatrices. À trancher par Charles s'il le veut.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `scheduling` (dont le nouveau test « bounds a manager's planning to the creators of his list »), `scheduling-calendar`, `scheduling-leaves-swaps`, `scheduling-reports`, `tenant-isolation`.
