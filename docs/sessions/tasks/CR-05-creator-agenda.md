# CR-05 Agenda de la créatrice : tâches, dispos, routine et suggestions

Statut : in-progress, lot a fusionné (#497, #502), lots b1 et b2 fusionnés (#504, #508), lot b3 en PR (ADR 0042 § 3 et § 4, acceptée par Charles le 02/11/2026 ; remplace la partie `creator-tasks` d'EQ-09)
Phase : espaces (ADR 0042)
Dépend de : CR-01, CR-02, CR-12 (couche des shifts)
Branche : task/cr-05-creator-agenda

## Objectif

La créatrice a un vrai agenda, aussi simple que ceux qu'elle connaît, où l'agence et l'IA ne font que suggérer et où sa routine nourrit sa série.

## Contexte à lire

`docs/adr/0042-creator-space.md` (§ 3, § 4), EQ-09 (concepts de routine), la lecture d'Imperium (routine à deux couches, série, joker, pièges du fuseau, hors dépôt), `docs/design/README.md`.

## À faire

- [x] Vocabulaire (Charles, 02/11, 20h17, « ok tâche + dispo ») : à l'écran, elle n'a que des **tâches** (ce qu'elle fait : tournage, live, post, rendez-vous ; avec une heure de début et de fin, ou juste un jour, à cocher) et des **dispos** (le temps qu'elle ouvre à l'agence). Le bouton dit « Ajouter », puis « Une tâche » ou « Une dispo ». Le mot « créneau » n'apparaît jamais dans son espace ni dans `creator-tasks` : il est celui des shifts (`ShiftSlot`, ADR 0049). Le « créneau » de l'ADR 0042 § 3 (élément à heures) devient une tâche à heures ; le modèle garde la différence avec ou sans heure.
- [x] Module `creator-tasks` (nom du glossaire) : éléments (tâche à heures, tâche du jour, routine), catégories, rappels choisis par elle ; suggestions (de l'agence ou de l'IA) avec états suggérée, acceptée, refusée (motif facultatif) ; disponibilités récurrentes ou ponctuelles.
- [x] Règles pures : une suggestion datée ne tombe que dans une disponibilité, jamais sur un élément existant ; une tâche refusée n'est pas resuggérée la semaine suivante ; série et journée réussie ou parfaite dans **son** fuseau, un joker, paliers 7, 14, 30, 50, 100 ; double coche sans doublon.
- [x] Son lien iCal de l'agenda, sur la table des liens de calendrier de CR-12 (jeton haché, route sans session, révocable). Reste, avec la couche ci-dessous (lot c3) : elle peut y ajouter les shifts de ses comptes (ADR 0045 § 5).
- [ ] La couche « shifts de mes comptes » dans son Agenda (ADR 0045 § 1), par la lecture de CR-12, masquable.
- [x] Écrans : Jour et « Ma semaine » sur téléphone, Semaine et Mois sur ordinateur ; appui long ou glisser pour créer, glisser pour déplacer, balayer pour changer de jour ; consultation et coche hors ligne, synchronisées au retour.
- [x] Vue Jour, tâches d'abord (Charles, 02/11, 19h17 et 19h27) : en tête, l'avancement du jour (fait / à faire), la tâche par laquelle commencer et le prochain moment (« Ensuite : … à 21 h, dans 1 h 50 ») ; ses éléments datés en cartes lisibles (heure, titre), une barre proportionnelle seulement sur ordinateur ; puis « À faire » et « Programme », où un temps libre se touche pour créer (équivalent : un bouton « Ajouter » dans le Programme). Pas de grille horaire qui défile dans la page sur téléphone.
- [ ] Chaque tâche dit à quoi elle sert (une phrase, sans chiffre inventé) et porte son action quand elle en a une : « Déposer » ouvre le dépôt de CR-06 lié à la tâche et la coche quand les fichiers sont envoyés.
- [ ] Les shifts de ses comptes ne sont jamais sur la frise de sa journée : une ligne discrète sous le Programme, « Qui répond à tes fans dans {plateforme du compte} : … », une ligne par plateforme si elle en a plusieurs (le nom vient du compte, le cœur ne connaît pas les plateformes). Libellés : « Dispo pour l'agence » pour une disponibilité, « Qui répond à tes fans » pour la couche des shifts ; aucune légende sous la vue Jour.
- [x] Chaque geste (appui long, glisser, balayer) a son équivalent au clavier et par un bouton ; balayer pour changer de jour n'entre jamais en concurrence avec le défilement de la grille.
- [x] Écran agence : suggérer une tâche (avec ou sans heure), voir ce qui est accepté, refusé, fait.

## Critères d'acceptation

- Tests : passage de minuit et heure d'été dans son fuseau, série qui casse puis repart, joker, suggestion hors disponibilité laissée sans date, double coche, coche hors ligne rejouée sans doublon.
- Le flux iCal s'ouvre dans Apple Agenda et Google Agenda.
- Finition : captures Nuit et Jour, téléphone et bureau, mouvement réduit ; vérifié sur un iPhone installé.

## Hors périmètre

Le topo de la semaine qui fabrique les suggestions de l'IA (CR-07) ; la catégorie Réseaux automatisée (chantier 6).

## Notes de session

- 2026-11-03 (lot b1) : onglet Agenda dans sa barre (Aujourd'hui · Agenda · Ventes · Moi), vues Jour et « Ma semaine » (téléphone et ordinateur), « Ajouter » → « Une tâche » ou « Une dispo », proposition de l'agence acceptée, placée ou refusée (« Non merci », motif facultatif), tâche ouverte et retirée, dispo retirée. Hors ligne : sa dernière lecture de chaque semaine et ses coches gardées sur l'appareil (`impera.agenda.*`, effacées à la déconnexion avec le reste de l'appareil), envoyées au retour du réseau ; une coche que le serveur refuse (tâche changée, plus de 48 h) est dite une fois. Reste : lot b2 (Semaine et Mois sur ordinateur, appui long et glisser, balayer pour changer de jour), lot b3 (rappels par Web Push), lot c. Remarque de Bilan sur #502, à garder en tête : si elle voyage, son téléphone date la coche dans le fuseau du lieu et le serveur la relit dans le fuseau de son profil ; une coche de routine faite près de minuit peut alors tomber sur l'autre jour. C'est la règle de l'ADR 0042 (« dans son fuseau »), à dire à l'écran si le cas se présente.
- 2026-11-03 (lot b2) : sur ordinateur, Semaine en grille d'heures (une colonne par jour, ses dispos hachurées, les propositions en pointillés, une rangée « tâches » pour les tâches du jour, l'heure qui s'ouvre sur maintenant) et Mois (ses semaines du mois, trois lignes par jour puis « +N », un jour s'ouvre dans Jour, flèches du clavier). Glisser sur un temps libre crée une tâche à ces heures, glisser une tâche la déplace en gardant sa durée (appui long au toucher) ; « Changer le moment » fait la même chose au clavier depuis la tâche ouverte (`PATCH /v1/creator-space/tasks/:id`). Jour sur ordinateur gagne une frise proportionnelle de ses heures ; Jour au toucher change de jour d'un balayage. Reste : lot b3 (rappels par Web Push), lot c.
- 2026-11-03 (lot b3) : ses rappels sonnent. Une tâche à heures avec un rappel met en file `creator_tasks.remind` dans la transaction de son écriture (une clé par tâche, remplacée à chaque écriture : un déplacement emporte son rappel) ; le job ne sonne que pour le début programmé, si la tâche est encore là et pas commencée, une fois par compte, sous ses heures calmes et son plafond (`notify` du module `notifications`). Reste : lot c (écran agence, iCal, couche des shifts).
- 2026-11-03 (lot c1) : écran agence, Créatrices › Agenda (propriétaire, et manager actif pour cet onglet seul : Charles, 05/11 17h22, « Ouvrir aux managers » ; son menu gagne Créatrices, qui s'ouvre sur l'agenda, Persona, Heures, Accès et Pourcentage restant au propriétaire). « Proposer une tâche » (à une heure, un jour, chaque semaine ; ses heures à elle, la ville dite si le lecteur est ailleurs), puis sa semaine en trois groupes : en attente, acceptées (faite, pas encore cochée, déplacée ou placée, routine « 2 sur 7 », retirée), refusées avec son motif. L'API rend le suivi de chaque suggestion acceptée (`task` : moment gardé, `doneDays`, `removed`). Reste : lot c2 (lien iCal), lot c3 (couche « shifts de mes comptes » et la ligne « Qui répond à tes fans »), la fiche de tournage à l'écran (après VEI-01 d1, #513), « Déposer » (CR-06).
- 2026-11-05 (fiche de tournage) : sa fiche de tournage (`shootBrief`, VEI-01 d1) à l'écran, en texte brut avec ses retours à la ligne : pliée sous « 🎬 Fiche de tournage » sur une proposition, ouverte dans la tâche qu'elle a acceptée. Les trois boutons d'une tâche ouverte passent à la ligne sur téléphone au lieu de sortir du cadre.
- 2026-11-05 (lot c2) : son lien de calendrier. « 📲 Mon agenda dans mon téléphone », sous son agenda, ouvre le même parcours que Moi › Calendrier du chatteur (`CalendarLinkBody`, partagé) avec ses mots : l'adresse montrée une fois, Apple, Google, copier, remplacer, couper. Même table et mêmes routes que l'équipe (`/v1/scheduling/calendar-link`, ouvertes au rôle `creator`) ; son flux « Impera · mon agenda » porte ses tâches à heures et celles d'un jour (en date), lues avec ses droits par `creator-tasks`, jamais ses routines ni le texte d'une fiche de tournage. Reste : lot c3 (les shifts de ses comptes dans son agenda et dans son lien).

- 2026-11-03 (lot a, #497) : module `creator-tasks`, migration 0103 (tâches, coches, dispos, suggestions), routes de son agenda et des suggestions de l'agence. Rappels choisis par elle : la colonne existe, l'envoi des rappels vient avec les écrans (lot b, Web Push de CR-01). Lot b : écrans Jour, Ma semaine, Semaine, Mois, hors ligne ; lot c : écran de suggestion de l'agence, iCal, couche des shifts.

- 2026-11-02 (fil espaces) : prototype de référence https://claude.ai/artifact/7DVK3ZCP2BwCS7G7itkBsW (copie hors dépôt dans les fichiers du projet, `espaces/prototype-creatrice/`), design validé par Charles le 02/11 à 19h17. La vue Jour a été refaite deux fois à sa demande : la frise d'origine (shifts en bandes, disponibilités hachurées) était illisible sur téléphone et donnait plus de place aux chatteurs qu'à ses tâches. Vérifié à 320, 360, 375, 390 et 414 px de large.
