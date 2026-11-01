# 0031. Congés et échanges de shift : le congé appartient au membre, l'échange se fait entre chatteurs

Statut : accepted (Charles, 27/10/2026 20h56)
Date : 2026-10-27
Remplace : dans l'ADR 0023 (§ Données et RLS), « congés » dans la phrase « Shifts, rapports, congés et échanges portent `creator_id` **et** `member_id` »

## Contexte

L'ADR 0023 range les congés avec les shifts, les rapports et les échanges : chaque ligne porterait une créatrice et un membre, et la RLS demanderait les deux. La raison donnée vaut pour les rapports : deux chatteurs d'une même créatrice ne doivent pas lire leurs montants.

Un congé n'est pourtant pas pris sur une créatrice : « du 24 au 26 décembre », le membre est absent pour toutes les créatrices sur lesquelles il travaille. Avec une créatrice sur la ligne, il faudrait écrire un congé par créatrice et les garder d'accord. Et quand la liste des créatrices du membre change, un congé déjà validé ne couvrirait pas la nouvelle.

Pour les échanges, Charles a tranché le 27/10 (carte de 20h39, « Comme Imperium, sans manager ») : le chatteur choisit un collègue, le collègue accepte, et l'échange se fait aussitôt. Le manager est prévenu et peut l'annuler. La fiche EQ-02 prévoyait qu'un manager valide les échanges ; ce n'est plus le cas.

Ce choix a une conséquence sur la base. Les politiques de `shifts` (migration 0021) ne laissent écrire que le propriétaire ou un manager actif, une créatrice par transaction. Or c'est un chatteur qui accepte un échange, et l'échange peut porter sur deux créatrices.

## Décision

**Un congé appartient au membre.** La table des congés porte `member_id` et pas de créatrice. Elle suit la politique des tables de l'équipe (ADR 0023 § Données et RLS) : un membre lit ses congés, et le scope `agency` (le propriétaire ou un manager actif) lit tout. Une créatrice ne lit aucun congé.

- Le membre demande son congé, en jours de son propre fuseau. Le serveur fixe les deux instants du congé à la création, pour qu'un changement de fuseau ne le déplace pas.
- Le propriétaire ou un manager actif valide ou refuse. Un manager ne décide jamais de son propre congé ; le propriétaire décide du sien, puisque personne ne décide pour lui.
- Avant la validation, plus aucun shift du membre ne couvre la période : le manager les a donnés à quelqu'un d'autre ou annulés. Sinon la validation répond 409 avec ces shifts, pour qu'aucun compte ne se retrouve sans personne sans qu'on l'ait vu. La validation fait aussi tomber les propositions d'échange ouvertes qui donneraient au membre un shift pendant ce congé.
- Pendant un congé validé, aucun shift ne se pose sur le membre : ni à la main, ni par un modèle, ni par un échange. L'occurrence d'un modèle qui tombe dans le congé apparaît dans le bandeau ambre du planning, comme un shift à pourvoir, avec de quoi le donner à quelqu'un d'autre.
- Le propriétaire ou un manager actif peut annuler un congé validé qui n'est pas fini. Le congé garde l'instant de sa validation (`decidedAt`) et prend celui de l'annulation (`cancelledAt`) ; ses instants de début et de fin ne changent pas. Il ne compte plus à partir de l'annulation : annulé avant de commencer, il ne couvre rien ; annulé en cours, il couvre les jours déjà pris, et le membre peut être planifié aussitôt.
- Le statut du membre (`on_leave`, EQ-01) ne change pas tout seul. Il reste le réglage du propriétaire, qui décide aussi des droits d'un manager (ADR 0024).

**Un échange se fait entre chatteurs, sans manager.** Il porte les deux créatrices et les deux membres concernés ; la RLS de l'ADR 0023 s'y applique telle quelle pour la lecture : la créatrice d'un des deux shifts, **et** (le membre est l'un des deux, ou le scope est `agency`).

- Le chatteur propose un de ses shifts qui n'a pas commencé à un collègue actif de la même créatrice : soit il le lui donne, soit il l'échange contre un shift de ce collègue, sur une créatrice où lui-même travaille.
- Pour choisir, il voit le nom affiché de ces collègues et leurs shifts à venir qu'il pourrait prendre, rien d'autre (ni taux, ni pays, ni statut). C'est la seule porte par laquelle un chatteur lit le planning d'un autre.
- Le collègue accepte ou refuse. S'il accepte, les shifts changent de mains dans la même transaction, aux mêmes règles qu'un shift posé à la main (jamais deux shifts à la fois, jamais deux membres sur un compte, rien sur un membre en congé validé). Les autres propositions sur ces shifts tombent.
- Le propriétaire ou un manager actif voit chaque échange, et peut l'annuler tant qu'aucun des deux shifts n'a commencé : les shifts reviennent à leurs membres d'avant.

**Les écritures restent sous RLS.** Pas de connexion admin pour le geste d'un chatteur, et pas de fonction `SECURITY DEFINER` (il n'y en a aucune dans le dépôt).

- L'acceptation d'un échange passe par une politique d'écriture dédiée sur `shifts` : un chatteur peut changer le membre d'un shift quand un échange `accepted` dans la transaction en cours, dont il est le collègue sollicité, nomme ce shift ; le nouveau membre doit être l'autre membre de cet échange, et les heures celles que l'échange a notées à la proposition. L'échange accepté est sa propre preuve. Une politique de lecture de la même forme lui laisse lire le shift qu'on lui propose.
- Les autres propositions qui nomment ces shifts ne peuvent plus être acceptées : l'acceptation vérifie que chaque shift a encore le membre et les heures notés à la proposition. Un job les passe `lapsed` juste après (connexion admin, comme le job des modèles). Une politique des échanges qui lirait `shifts` bouclerait avec celle de `shifts` qui lit les échanges, et Postgres refuse ces boucles.
- Quand l'échange porte sur deux créatrices, la transaction pose la créatrice de chaque shift tour à tour avant de l'écrire. L'annulation d'un échange par le propriétaire ou un manager actif fait le même aller-retour, sous la politique d'écriture de l'équipe.
- Le chatteur qui accepte ne lit jamais les congés de l'autre membre. Celui qui propose voit les siens quand il propose, et un congé validé après la proposition la fait tomber (point des congés ci-dessus).
- La validation d'un congé lit les shifts du membre et fait tomber ses propositions créatrice par créatrice, dans sa transaction et sous la politique de l'équipe.

**Un verrou par membre.** Chaque écriture qui pose un shift sur un membre, et la validation d'un congé, prennent `pg_advisory_xact_lock` sur une clé propre au planning, `hashtextextended('scheduling.member:' || member_id, 0)`. Ce n'est pas un `FOR UPDATE` sur `team_members` : une transaction d'une créatrice ne voit pas forcément la ligne du membre sous la RLS des tables de l'équipe, alors que le verrou consultatif ne dépend pas de la RLS. Les chemins qui le prennent sont la création et la modification d'un shift, le job des modèles, l'acceptation et l'annulation d'un échange, et la validation d'un congé. Quand deux membres sont en jeu, les deux verrous se prennent dans l'ordre de leurs identifiants.

## Conséquences

- La table des congés ne prend pas de `creator_id`. Les autres points de l'ADR 0023 sur les données ne changent pas.
- Un congé validé et un shift posé au même moment ne peuvent pas réussir tous les deux.
- La migration des tables (numéro attribué par le propriétaire de `packages/db`) écrit les politiques dédiées de l'acceptation. Les tests d'intégration vérifient qu'un chatteur ne déplace un shift que par un échange accepté dans la même transaction qui le nomme, et vers l'autre membre de cet échange, et que la validation d'un congé et l'acceptation d'un échange se sérialisent dans les deux ordres.
- `PlanningConflict` prend une troisième raison, `member_on_leave`, qui ne pointe vers aucun shift.
- Les lectures « en congé à cet instant » prennent les congés `approved`, et les congés `cancelled` avant leur `cancelledAt`.
- Les rappels et les notifications d'un échange ou d'un congé viennent avec EQ-12. D'ici là, le manager voit les échanges et les congés dans le planning.
