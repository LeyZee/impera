# EQ-12 Annonces, prise de poste et notifications de l'équipe, sans Telegram
Statut : todo (ID validé par Charles le 27/10/2026, 15h11 : « je les veux tous »)
Phase : équipe (ADR 0023, ADR 0024)
Dépend de : EQ-02 (shifts), EQ-10 (connexion du chatteur), EQ-11 (shell par rôle) ; les rappels de pièces se branchent sur EQ-06 quand elle existe
Branche : task/eq-12-team-notifications

## Objectif
Prévenir chaque membre de l'équipe sur son téléphone, même quand il n'a pas Nirvana ouvert : ce que faisait Telegram dans Imperium, sans Telegram, et voir dès le début d'un shift qu'il n'est pas pris.

## Contexte à lire
`docs/adr/0023-team-management.md`, `docs/adr/0024-roles-and-navigation.md`, EQ-02, EQ-03, EQ-06, EQ-10, `docs/reference/legacy-projects.md` (la spécification PWA d'Imperium : Web Push, service worker), ADR 0016 (secrets posés depuis le CRM), ADR 0020 (une notification ne porte jamais de donnée de fan). Charles (27/10) ne veut plus de Telegram pour l'équipe. EQ-02 et EQ-03 mettent le rappel de shift et le rapport manquant « dans l'application », c'est-à-dire seulement quand le membre l'a ouverte ; les Annonces figurent dans Équipe (ADR 0024) et le manager peut en publier (EQ-01), mais aucune autre fiche ne les construit.

## À faire
- [ ] **Annonces** (`announcement`) : le propriétaire ou un manager actif écrit une annonce à toute l'équipe ou aux membres d'une créatrice ; elle s'affiche dans Aujourd'hui avec « Lu » ; l'auteur voit qui l'a lue. Jamais de donnée de fan.
- [ ] **Prise de poste** (`shift_check_in`) : « Je prends mon poste » en un geste dans Aujourd'hui, et depuis la notification de début de shift. Elle date le vrai début du shift ; le passage pour vendre d'EQ-08 part au premier membre qui a pris son poste.
- [ ] **Shift non pris** (`unstarted_shift`) : sans prise de poste dans le délai qui suit le début du shift, le manager en poste ou le propriétaire reçoit une alerte importante (jamais urgente) dans À traiter, avec la liste des membres libres sur ce créneau. Le délai est un réglage, pas une valeur dans le code.
- [ ] **Espace installable** : l'espace du chatteur s'installe comme une app sur le téléphone (manifeste, service worker), sur le modèle prévu pour la PWA de la créatrice (EQ-09). Le service worker ne met en cache que la coquille statique, jamais une réponse de `/v1/*` : un téléphone partagé ou repris ne garde aucune donnée de l'équipe hors session. Sur iPhone, les notifications n'arrivent qu'une fois l'espace ajouté à l'écran d'accueil : l'écran d'installation le dit, pas à pas.
- [ ] **Notifications push** (Web Push), avec l'accord du membre, réglables une par une dans Moi : début de shift, shift non pris (manager), rapport manquant, facture à accepter, nouvelle annonce, pièce du dossier qui expire bientôt (EQ-06). Les clés VAPID sont créées par le serveur à la première utilisation et chiffrées avec `CREDENTIALS_ENCRYPTION_KEYS`, comme les clés IA (ADR 0016) : rien à poser à la main, rien dans le dépôt.
- [ ] **Heures calmes** (`quiet_hours`) dans le fuseau du membre : rien n'est envoyé, sauf le début de son propre shift ; ce qui tombe pendant reste dans Aujourd'hui.
- [ ] **Une seule fois** : un registre `notification_deliveries` à clé unique (membre, objet, motif), écrit dans la même transaction que la décision d'envoyer, garantit qu'un rappel part une seule fois, même rejoué. Le `jobKey` Graphile ne sert qu'à replanifier quand un shift bouge : il ne déduplique qu'un job encore en attente.
- [ ] Abonnements push dans une table lue par `withMember`, chacun ne lit que les siens ; un abonnement refusé ou expiré (410) est retiré, sans erreur pour le membre.
- [ ] Une notification ne contient jamais de donnée de fan, de montant d'un autre membre, ni de lien qui ouvrirait une session sans mot de passe.

## Critères d'acceptation
- Tests : rappel envoyé une seule fois par shift (idempotence) ; heures calmes respectées dans le fuseau du membre, changement d'heure compris ; un membre parti ne reçoit plus rien ; un shift pris à temps ne déclenche aucune alerte, un shift non pris en déclenche une seule ; un abonnement expiré est retiré ; un rejeu du job après l'envoi n'envoie rien (registre) ; le service worker ne sert aucune réponse de `/v1/*` depuis son cache.
- Le refus des notifications par le membre laisse tout visible dans Aujourd'hui.
- Aucune durée en dur dans les écrans ; textes en français, apostrophes typographiques.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Envoi d'e-mails ou de SMS, notifications de la créatrice (EQ-09), signaux de coaching (plus tard).

## Notes de session
