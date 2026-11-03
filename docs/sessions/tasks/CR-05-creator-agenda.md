# CR-05 Agenda de la créatrice : tâches, dispos, routine et suggestions
Statut : in-progress, lot a fusionné (#497, #502), lot b1 en PR (ADR 0042 § 3 et § 4, acceptée par Charles le 02/11/2026 ; remplace la partie `creator-tasks` d'EQ-09)
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
- [ ] Son lien iCal de l'agenda, sur la table des liens de calendrier de CR-12 (jeton haché, route sans session, révocable) ; elle peut y ajouter les shifts de ses comptes (ADR 0045 § 5).
- [ ] La couche « shifts de mes comptes » dans son Agenda (ADR 0045 § 1), par la lecture de CR-12, masquable.
- [ ] Écrans : Jour et « Ma semaine » sur téléphone, Semaine et Mois sur ordinateur ; appui long ou glisser pour créer, glisser pour déplacer, balayer pour changer de jour ; consultation et coche hors ligne, synchronisées au retour.
- [ ] Vue Jour, tâches d'abord (Charles, 02/11, 19h17 et 19h27) : en tête, l'avancement du jour (fait / à faire), la tâche par laquelle commencer et le prochain moment (« Ensuite : … à 21 h, dans 1 h 50 ») ; ses éléments datés en cartes lisibles (heure, titre), une barre proportionnelle seulement sur ordinateur ; puis « À faire » et « Programme », où un temps libre se touche pour créer (équivalent : un bouton « Ajouter » dans le Programme). Pas de grille horaire qui défile dans la page sur téléphone.
- [ ] Chaque tâche dit à quoi elle sert (une phrase, sans chiffre inventé) et porte son action quand elle en a une : « Déposer » ouvre le dépôt de CR-06 lié à la tâche et la coche quand les fichiers sont envoyés.
- [ ] Les shifts de ses comptes ne sont jamais sur la frise de sa journée : une ligne discrète sous le Programme, « Qui répond à tes fans dans {plateforme du compte} : … », une ligne par plateforme si elle en a plusieurs (le nom vient du compte, le cœur ne connaît pas les plateformes). Libellés : « Dispo pour l'agence » pour une disponibilité, « Qui répond à tes fans » pour la couche des shifts ; aucune légende sous la vue Jour.
- [ ] Chaque geste (appui long, glisser, balayer) a son équivalent au clavier et par un bouton ; balayer pour changer de jour n'entre jamais en concurrence avec le défilement de la grille.
- [ ] Écran agence : suggérer une tâche (avec ou sans heure), voir ce qui est accepté, refusé, fait.

## Critères d'acceptation
- Tests : passage de minuit et heure d'été dans son fuseau, série qui casse puis repart, joker, suggestion hors disponibilité laissée sans date, double coche, coche hors ligne rejouée sans doublon.
- Le flux iCal s'ouvre dans Apple Agenda et Google Agenda.
- Finition : captures Nuit et Jour, téléphone et bureau, mouvement réduit ; vérifié sur un iPhone installé.

## Hors périmètre
Le topo de la semaine qui fabrique les suggestions de l'IA (CR-07) ; la catégorie Réseaux automatisée (chantier 6).

## Notes de session

- 2026-11-03 (lot b1) : onglet Agenda dans sa barre (Aujourd'hui · Agenda · Ventes · Moi), vues Jour et « Ma semaine » (téléphone et ordinateur), « Ajouter » → « Une tâche » ou « Une dispo », proposition de l'agence acceptée, placée ou refusée (« Non merci », motif facultatif), tâche ouverte et retirée, dispo retirée. Hors ligne : sa dernière lecture de chaque semaine et ses coches gardées sur l'appareil (`impera.agenda.*`, effacées à la déconnexion avec le reste de l'appareil), envoyées au retour du réseau ; une coche que le serveur refuse (tâche changée, plus de 48 h) est dite une fois. Reste : lot b2 (Semaine et Mois sur ordinateur, appui long et glisser, balayer pour changer de jour), lot b3 (rappels par Web Push), lot c. Remarque de Bilan sur #502, à garder en tête : si elle voyage, son téléphone date la coche dans le fuseau du lieu et le serveur la relit dans le fuseau de son profil ; une coche de routine faite près de minuit peut alors tomber sur l'autre jour. C'est la règle de l'ADR 0042 (« dans son fuseau »), à dire à l'écran si le cas se présente.

- 2026-11-03 (lot a, #497) : module `creator-tasks`, migration 0103 (tâches, coches, dispos, suggestions), routes de son agenda et des suggestions de l'agence. Rappels choisis par elle : la colonne existe, l'envoi des rappels vient avec les écrans (lot b, Web Push de CR-01). Lot b : écrans Jour, Ma semaine, Semaine, Mois, hors ligne ; lot c : écran de suggestion de l'agence, iCal, couche des shifts.

- 2026-11-02 (fil espaces) : prototype de référence https://claude.ai/artifact/7DVK3ZCP2BwCS7G7itkBsW (copie hors dépôt dans les fichiers du projet, `espaces/prototype-creatrice/`), design validé par Charles le 02/11 à 19h17. La vue Jour a été refaite deux fois à sa demande : la frise d'origine (shifts en bandes, disponibilités hachurées) était illisible sur téléphone et donnait plus de place aux chatteurs qu'à ses tâches. Vérifié à 320, 360, 375, 390 et 414 px de large.
