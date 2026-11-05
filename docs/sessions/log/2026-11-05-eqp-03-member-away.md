# 2026-11-05 — Recette EQP-03 et CHAT-09 : un membre suspendu ne tient plus ses shifts — done

Fait :

- `Planning.away` : pour le propriétaire et l'agence, le statut des membres nommés par le planning qui ne sont pas actifs (en congé, malade, en déplacement, suspendu, parti). Le chatteur lit une liste vide : il ne lit jamais le statut d'un collègue.
- Calendrier de l'agence : les shifts de ces membres ne comptent plus dans `toFill` ni dans la couverture ; la charge de travail reste celle qui a été planifiée.
- Équipe › Planning : leurs shifts restent dessinés, pâlis, contour ambre pointillé, le statut en ambre (« Suspendu ») ; leur créneau se lit et se compte « À pourvoir ». Le shift en cours d'un membre suspendu ne dit ni « en poste » ni le temps restant, et sa fiche dit « En cours ».
- Fiche d'un shift : « Théo est suspendu : personne ne tiendra ce shift. Choisis un autre membre, ou annule-le. » (en cours : « Arrête-le, puis ouvre un shift à un autre membre. »).
- Dialogue du statut : « N shifts à venir restent à son nom : personne ne les tiendra, et le planning les montre à pourvoir. »
- CHAT-09 : le membre qui n'est plus actif lit une carte unique en tête d'Aujourd'hui (à la place du shift), de Suivi et de son Planning (« Ton accès est suspendu · Tu n'as plus accès aux conversations de tes créatrices. Parle à ton responsable. ») ; son Planning ne dit plus « En poste ».

Pas fait : CHAT-02 (textes d'Aujourd'hui et de Suivi en attendant EQ-13) est fait par le fil Recette ; j'ai retiré mes changements dessus.

Décisions :
- tous les statuts autres qu'« actif » sont traités de même : le serveur ne donne aucune créatrice à un membre qui n'est pas actif (`routedCreatorIds`), donc personne ne tient ses shifts ;
- le statut passe par `Planning.away`, jamais par `PlanningMember`, qui sert aussi aux échanges et aux congés que lisent les chatteurs.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- intégration `scheduling` (le propriétaire et le manager lisent `away`, le chatteur non) et `scheduling-calendar` (places à pourvoir et couverture sans le membre suspendu) ;
- unitaires web : `PlanningPage` (pastille, compte, « À pourvoir », fiche), `MembersPage` (dialogue), `TodayPage`, `ChatterTrackingPage`, `MyPlanningPage`, `scheduling/model` ;
- captures Nuit et Jour, téléphone et ordinateur : `recette/2026-11-05/corrections/equipe/eqp03-chat09/` dans les fichiers du projet.
