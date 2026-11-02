# CR-12 Calendrier des shifts pour toute l'équipe et la créatrice : lecture, vue Mois, lien de calendrier
Statut : blocked (prototype du calendrier à valider par Charles, ADR 0045 § 7) (ADR 0045 § 1, § 2 et § 5, acceptée par Charles le 02/11/2026 ; ADR 0048 pour l'IA, à accepter)
Phase : espaces (ADR 0045)
Dépend de : EQ-02 (planning, module `scheduling`), P3-14 (heures d'activité de l'agent), CR-02 (chemin de lecture de la créatrice, pour sa couche) ; le prototype validé
Branche : task/cr-12-shift-calendar-read

## Objectif
Chacun sait qui chatte quand : un chatteur actif voit le planning de toute l'équipe, la créatrice celui de ses comptes, l'agence gagne la vue Mois et la charge de chacun, et chaque membre met ses shifts dans l'agenda de son téléphone.

## Contexte à lire
`docs/adr/0045-shift-calendar-for-everyone.md` (§ 1, § 2, § 5, § 7), `docs/adr/0048-agent-in-the-shift-calendar.md`, `docs/adr/0031-leaves-and-shift-swaps.md`, `docs/adr/0024-roles-and-navigation.md`, `docs/adr/0042-creator-space.md` (§ 2, § 4), EQ-02 (notes de session), `apps/api/src/modules/scheduling/README.md` et `infra/colleague-reads.ts`, `docs/design/README.md` (§ Finition d'un écran). Le prototype validé : https://claude.ai/artifact/8AJCiUp1ZoEXEvfx9wknPE (copie hors dépôt `/mnt/project-files/espaces/prototype-planning/planning.html`, données inventées).

## À faire
- [ ] Base (propriétaire de `packages/db`, migration relue par Bilan) : une fonction SQL `SECURITY DEFINER`, `STABLE`, `search_path` fixé, exécutable par le seul rôle applicatif, qui rend six colonnes (membre, nom dans l'équipe, couleur, créatrice, début, fin) des seuls shifts non annulés des créatrices de l'agence, sur une fenêtre bornée à 6 semaines, et applique elle-même la frontière : propriétaire ou scope `agency`, tout ; chatteur dont la ligne `team_members` est `active`, toute l'équipe, sinon ses seuls shifts ; créatrice, le seul `app.creator_id` ; tout autre appel, rien. Elle ne joint jamais `leave_requests`. La politique `member_read` de `shifts` et l'accès à `team_members` ne changent pas.
- [ ] Module `scheduling` : une lecture « calendrier » par cette fonction, exportée par `index.ts` ; contrat Zod (semaine ou mois, filtres créatrice et membre) ; un créneau à pourvoir n'a pas de membre ; le shift passé d'un membre parti garde son nom.
- [ ] Charge de chaque membre (heures planifiées de la semaine), pour l'agence seulement ; créneaux à pourvoir de la semaine, comptés, en tête.
- [ ] L'IA dans le calendrier (ADR 0048) : lecture des heures de réponse et du mode en vigueur de l'agent par créatrice, sous la même frontière que les shifts (jamais pour la créatrice ni un membre restreint, jamais dans le lien de calendrier) ; trait de l'IA sous les créneaux (vif en Automatique, pâle en Copilote), « IA seule » sur un créneau sans chatteur qu'elle couvre en entier en Automatique, qui ne compte plus à pourvoir ; l'IA dans « En poste », dans « qui avant, qui après » et dans la légende ; encart « Couverture des comptes » pour l'agence ; « Régler ses heures » ouvre Réglages › Agent.
- [ ] Les éléments de l'agenda de la créatrice marqués « utile à l'équipe » (ADR 0043 § 7) sur le calendrier de l'agence et du chatteur, dès que CR-05 les produit (lecture vide d'ici là).
- [ ] Écrans : Planning du chatteur, « l'équipe » en Semaine et Mois, en lecture (nom, couleur, créatrice, créneau, rien d'autre) ; Équipe › Planning gagne le Mois et la charge ; la couche « shifts de mes comptes » de la créatrice, masquable, posée dans son Agenda par CR-05. Mois : pastilles de couleur par jour, toucher un jour l'ouvre en détail ; téléphone : un jour à la fois (déjà fait) et la liste de la semaine ; filtres et semaine affichée gardés au retour.
- [ ] Liens de calendrier (iCal), une seule table pour les shifts et pour l'agenda de la créatrice (ADR 0042 § 4, que CR-05 y branche) : jeton gardé haché (SHA-256), comparé en temps constant ; route sans session, limitée en débit, `Cache-Control: private, no-store` ; le serveur retrouve le titulaire par le jeton et lit par la fonction ci-dessus avec ses droits, donc un membre restreint n'y garde que ses propres shifts ; lien en lecture seule, révocable (et révoqué par le départ, EQ-14), qui ne porte que le créneau, la créatrice et le nom dans l'équipe. Chaque membre a le lien de ses propres shifts, dans Moi. Le nom de la table entre au glossaire avec la migration.

## Critères d'acceptation
- Test d'intégration RLS de chaque frontière : propriétaire, manager, chatteur actif, chatteur `on_leave`, `sick`, `travelling` et `suspended` (ses seuls shifts), créatrice (ses comptes seulement), compte inconnu (rien) ; le chatteur ne lit ni congé, ni taux, ni pays, ni statut d'un collègue, par aucune route ; fenêtre de plus de 6 semaines refusée ; la lecture de l'agent (ADR 0048) suit les mêmes frontières et ne rend rien à la créatrice.
- Tests de l'IA : créneau couvert en partie, heures qui passent minuit dans le fuseau de la créatrice, Copilote qui reste à pourvoir, Arrêt global qui efface le trait, couverture de la semaine qui fait 168 h par compte.
- Tests : créneau à pourvoir sans nom, shift d'un membre parti dans l'historique, mois qui passe le changement d'heure dans le fuseau de la grille.
- Lien iCal : jeton faux ou révoqué refusé sans dire lequel ; ouverture dans Apple Agenda et Google Agenda ; aucun montant ni donnée de fan dans le flux.
- Finition (Charles, 02/11, 16h45 : hiérarchie, navigation fluide, animations, survols, design system) : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, téléphone et ordinateur, mouvement réduit), relues par Extension.

## Hors périmètre
Poser, déplacer, ajouter en masse, suggérer (CR-13) ; notifications et rappels (EQ-12) ; l'agenda de la créatrice lui-même (CR-05) ; la fiche et le départ (EQ-14). Pas de vue annuelle, pas d'export PDF ni CSV.

## Notes de session
