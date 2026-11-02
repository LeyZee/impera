# CR-05 Agenda de la créatrice : créneaux, tâches, routine, suggestions et disponibilités
Statut : todo (ADR 0042 § 3 et § 4, acceptée par Charles le 02/11/2026 ; remplace la partie `creator-tasks` d'EQ-09)
Phase : espaces (ADR 0042)
Dépend de : CR-01, CR-02, CR-12 (couche des shifts)
Branche : task/cr-05-creator-agenda

## Objectif
La créatrice a un vrai agenda, aussi simple que ceux qu'elle connaît, où l'agence et l'IA ne font que suggérer et où sa routine nourrit sa série.

## Contexte à lire
`docs/adr/0042-creator-space.md` (§ 3, § 4), EQ-09 (concepts de routine), la lecture d'Imperium (routine à deux couches, série, joker, pièges du fuseau, hors dépôt), `docs/design/README.md`.

## À faire
- [ ] Module `creator-tasks` (nom du glossaire) : éléments (créneau, tâche, routine), catégories, rappels choisis par elle ; suggestions (de l'agence ou de l'IA) avec états suggérée, acceptée, refusée (motif facultatif) ; disponibilités récurrentes ou ponctuelles.
- [ ] Règles pures : une suggestion datée ne tombe que dans une disponibilité, jamais sur un élément existant ; une tâche refusée n'est pas resuggérée la semaine suivante ; série et journée réussie ou parfaite dans **son** fuseau, un joker, paliers 7, 14, 30, 50, 100 ; double coche sans doublon.
- [ ] Son lien iCal de l'agenda, sur la table des liens de calendrier de CR-12 (jeton haché, route sans session, révocable) ; elle peut y ajouter les shifts de ses comptes (ADR 0045 § 5).
- [ ] La couche « shifts de mes comptes » dans son Agenda (ADR 0045 § 1), par la lecture de CR-12, masquable.
- [ ] Écrans : Jour et « Ma semaine » sur téléphone, Semaine et Mois sur ordinateur ; appui long ou glisser pour créer, glisser pour déplacer, balayer pour changer de jour ; consultation et coche hors ligne, synchronisées au retour.
- [ ] Vue Jour, tâches d'abord (Charles, 02/11, 19h17 et 19h27) : en tête, l'avancement du jour (fait / à faire), la tâche par laquelle commencer et le prochain moment (« Ensuite : … à 21 h, dans 1 h 50 ») ; ses créneaux en cartes lisibles (heure, titre), une barre proportionnelle seulement sur ordinateur ; puis « À faire » et « Programme », où un temps libre se touche pour créer. Pas de grille horaire qui défile dans la page sur téléphone.
- [ ] Chaque tâche dit à quoi elle sert (une phrase, sans chiffre inventé) et porte son action quand elle en a une : « Déposer » ouvre le dépôt de CR-06 lié à la tâche et la coche quand les fichiers sont envoyés.
- [ ] Les shifts de ses comptes ne sont jamais sur la frise de sa journée : une ligne discrète sous le Programme, « Qui répond à tes fans dans Reveal : … ». Libellés : « Dispo pour l'agence » pour une disponibilité, « Qui répond à tes fans » pour la couche des shifts ; aucune légende sous la vue Jour.
- [ ] Chaque geste (appui long, glisser, balayer) a son équivalent au clavier et par un bouton ; balayer pour changer de jour n'entre jamais en concurrence avec le défilement de la grille.
- [ ] Écran agence : suggérer une tâche ou un créneau, voir ce qui est accepté, refusé, fait.

## Critères d'acceptation
- Tests : passage de minuit et heure d'été dans son fuseau, série qui casse puis repart, joker, suggestion hors disponibilité laissée sans date, double coche, coche hors ligne rejouée sans doublon.
- Le flux iCal s'ouvre dans Apple Agenda et Google Agenda.
- Finition : captures Nuit et Jour, téléphone et bureau, mouvement réduit ; vérifié sur un iPhone installé.

## Hors périmètre
Le topo de la semaine qui fabrique les suggestions de l'IA (CR-07) ; la catégorie Réseaux automatisée (chantier 6).

## Notes de session

- 2026-11-02 (fil espaces) : prototype de référence https://claude.ai/artifact/7DVK3ZCP2BwCS7G7itkBsW (copie hors dépôt dans les fichiers du projet, `espaces/prototype-creatrice/`), design validé par Charles le 02/11 à 19h17. La vue Jour a été refaite deux fois à sa demande : la frise d'origine (shifts en bandes, disponibilités hachurées) était illisible sur téléphone et donnait plus de place aux chatteurs qu'à ses tâches. Vérifié à 320, 360, 375, 390 et 414 px de large.
