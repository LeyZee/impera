# 2026-11-07 — CRM-08 : l'écran de revue de l'équipe Reveal (ADR 0076)

Fait :
- Onglet Équipe › Reveal (`/equipe/reveal`), au propriétaire et aux managers actifs, avec le compteur des nouveaux venus et des retraits. L'onglet n'apparaît que si `…/team/counts` répond : un chatteur lit un 403 et ne le voit pas.
- « À confirmer » : proposition et raison de chaque ligne, cases présélectionnées par le serveur, options bornées par `actions`, lot en une fois (par 200), refus d'une ligne dit sous elle. « Écarter », et « Reprendre » depuis le repli « Bots et comptes écartés ».
- « Inviter » : `AddMemberPanel` prend un mode invitation (prérempli depuis Reveal, e-mail non modifiable, `POST …/team/:id/invitation`, mot de passe redemandé dans le panneau). Pour un manager : pas de choix de rôle, préréglages seulement, créatrices de sa propre liste, celles de ses modèles Reveal cochées.
- « Reliés » : lien changé sur place (lot d'une ligne) ; la ligne d'un manager sur lui-même reste sans geste ; retrait en ambre (`removalLine` d'Équipe), modèles, écart de créatrices.
- Réglages › Ventes : `ChatterLinks` et `linkChatter` retirés, remplacés par un renvoi vers Équipe › Reveal avec ses compteurs (`TeamLink`).

Décisions : la revue vit dans Équipe (défaut, carte posée à Charles « Onglet Équipe » ou « Deux endroits ») parce que Réglages › Ventes est au seul propriétaire et que l'ADR 0076 l'ouvre aux managers actifs.

Découvertes : la carte « À traiter » du Dashboard et le compteur de Réglages pour l'alerte de retrait (ADR 0076 § 5) restent à faire ; la route `PUT …/chatters/:id` (ADR 0050 § 5) n'a plus d'appelant dans l'écran.

Candidats à suppression : la route `PUT /v1/settings/sales-feeds/:platform/chatters/:platformChatterId`, si Bilan confirme qu'elle ne sert plus.

Vérifié : voir la PR.
