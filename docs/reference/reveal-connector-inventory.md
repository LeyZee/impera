# Reveal : ce que le connecteur doit savoir faire

Dernière revue : 2026-10-17. Statut : **proposé**, à confirmer par la capture (`docs/runbooks/reveal-recording.md`) et l'analyse P1-02. Décision de stratégie : ADR 0008 (session capturée, client API serveur).

Ce document liste les capacités dont l'agent a besoin sur Reveal, pourquoi le métier en a besoin, et ce que la capture doit montrer pour chacune. Les endpoints réels iront dans `docs/reference/reveal-api-observed.md` ; le double de test dans `docs/reference/fake-reveal.md`.

## Pourquoi chaque capacité

Le métier (Charles, 17/10) : le fan vient chercher une relation. L'agent fait d'abord le KYC, consigné dans la **note client** du fan, qui sert de mémoire sur des mois. Il sexualise quand une ouverture apparaît, puis vend des PPV en sexto en **déroulant un script natif de Reveal**, avec de la vie entre les étapes, sans jamais renvoyer un script déjà envoyé au même fan. Chaque ligne ci-dessous sert ce parcours.

## Lecture

| # | Capacité | Méthode du port | Pourquoi | Ce que la capture doit montrer |
|---|---|---|---|---|
| L1 | État de la session | `health()` | Coupe-circuit, re-sync (`runbooks/session-expired.md`) | Appel de démarrage (profil courant, config), réponse quand la session est invalide |
| L2 | Boîte de réception : conversations, non-lus, dernier message | `listConversations()` | Savoir à qui répondre sans ouvrir chaque conversation | Liste paginée, filtres (non lus, payeurs), champs non-lus et aperçu |
| L3 | Messages d'une conversation, tout l'historique | `fetchMessages()` | Contexte de réponse ; import initial de l'historique | Pagination vers le passé jusqu'au premier message ; types de messages (texte, média, PPV verrouillé ou acheté, tip, message système, message de masse) |
| L4 | Temps réel | `subscribe?()` | Répondre vite sans marteler l'API | WebSocket ou polling, fréquence du client officiel, événement « nouveau message » et « achat » |
| L5 | Profil d'un fan | `getFanProfile?()` (nouveau) | KYC, priorité, détection des fans fragiles | Pseudo, date d'abonnement, statut, total dépensé, listes ou étiquettes, âge vérifié s'il existe |
| L6 | Historique d'achat d'un fan, ventes du compte | `listTransactions?()` | Échelle de prix, ne pas vendre deux fois, mesurer le CA du bot | Page ventes ou relevés ; comment un achat de PPV apparaît (message, transaction, événement) |
| L7 | Note client d'un fan | `getFanNote?()` (nouveau) | Mémoire longue partagée avec les chatteurs ; import des notes existantes | Lecture de la note, format (texte libre, champs), date de modification |
| L8 | Scripts natifs : liste et contenu | `listPlatformScripts?()` (nouveau) | L'agent pioche dans les scripts de l'agence | Liste, dossiers, contenu d'un script : étapes, textes, médias, prix, délais |
| L9 | Scripts déjà envoyés à un fan | `getScriptHistory?()` (nouveau) | Règle « jamais deux fois le même script au même fan » | Indicateur « déjà envoyé » que Reveal expose (Charles, 17/10) : sa forme dans l'API, par script ou par étape |
| L10 | Coffre (médias de la créatrice) | `listVaultMedia?()` (nouveau) | Décrire et indexer les médias des scripts (L15) | Liste paginée, dossiers, type, identifiant réutilisable à l'envoi |
| L11 | Notes du modèle (panneau de droite d'une conversation) | `getCreatorNotes?()` (nouveau) | C'est la fiche persona de Messalina vue par Reveal (Charles, 17/10) : la garder alignée sur la persona versionnée | Lecture, format, si elles sont par compte ou par conversation |
| L12 | Statistiques du fan (panneau de droite) | `getFanProfile?()` | Priorité, rythme de vente, fans à ménager | Chaque statistique affichée et l'appel qui la fournit |
| L13 | Onglet PPV d'une conversation : PPV envoyés, achetés, prix, statistiques de vente | `getFanPpvStats?()` (nouveau) | Charles : « l'agent doit en avoir conscience absolument » ; prix à proposer, taux d'achat, ce qui a déjà été vendu | Appels de l'onglet PPV, champs, période couverte |
| L14 | Fichiers des médias : reçus d'un fan, et ceux des bundles envoyés | `fetchMedia?()` (nouveau), branché sur le port `FetchMedia` de la vision (PR #81) | Charles (17/10) : l'agent doit **voir** les photos et vidéos que le fan envoie et celles des bundles, pas seulement leurs métadonnées (rôle Vision) | URL du fichier (signée ou non), durée de validité et renouvellement (runbook 11d), en-têtes nécessaires, type MIME, taille, miniature ou original, vidéo en flux ou en fichier, ce que Reveal sert pour un média verrouillé |
| L15 | Fichiers originaux des médias des scripts et du Vault, côté créatrice (non floutés) | `fetchMedia?()` | Le bot n'envoie que des étapes de scripts dont les bundles sont préparés à l'avance (Charles, 17/10 18h18) : chaque photo et vidéo est téléchargée **une fois à l'import**, décrite par le rôle Vision, puis indexée | Ouverture d'une vidéo depuis une étape de script et depuis le Vault : URL directe ou flux segmenté (HLS/DASH), signature et durée de validité, format, taille, débit, protection éventuelle |

## Écriture

Toute écriture porte une clé d'idempotence et passe par `verifySent` (ADR 0008, `connectors.md`). Aucune écriture vers un vrai fan sans demande explicite de Charles (règle 12) ; la capture fait les écritures vers un **fan test** seulement.

| # | Capacité | Méthode du port | Pourquoi | Ce que la capture doit montrer |
|---|---|---|---|---|
| E1 | Envoyer un texte | `sendText()` | Conversation, KYC, vie entre les étapes | Requête d'envoi, identifiant renvoyé, présence d'un identifiant client (nonce) réutilisable comme clé d'idempotence |
| E2 | Envoyer un PPV (médias du coffre + prix + texte) | `sendMedia()` | Non utilisé par l'agent (voir plus bas) ; à comprendre pour lire l'historique et pour les vocaux | Corps de la requête (références de médias, prix, devise), bornes de prix |
| E3 | Envoyer une étape de script natif | `sendScriptStep?()` (nouveau) | Vente par script ; Reveal garde la trace de l'envoi | Endpoint dédié ou envoi ordinaire ; ce qui marque l'étape comme envoyée |
| E4 | Écrire la note client | `setFanNote?()` (nouveau) | Consigner le KYC | Remplacement complet ou ajout ; conflit si un chatteur écrit en même temps |
| E4b | Écrire les notes du modèle | `setCreatorNotes?()` (nouveau) | Pousser la persona à jour dans Reveal, à la demande de Charles seulement | Remplacement ou ajout, portée |
| E5 | Vérifier un envoi | `verifySent()` | Rejeu sans doublon après une erreur réseau | Ce que Reveal renvoie à l'envoi (identifiant, horodatage, nonce client accepté ?) et si la relecture du fil retrouve le message : runbook étape 11a. Le job d'envoi appelle `verifySent` avant tout renvoi (revue 09, G2) |
| E6 | Marquer lu, indiquer « en train d'écrire » | `markRead?()`, `setTyping?()` | Rythme humain | Appels faits par le client officiel à l'ouverture et à la frappe |
| E7 | Envoyer un vocal (gratuit, ou dans un bundle si Reveal l'accepte) | `sendMedia()` avec `kind: audio` | Vocaux dans la voix de la créatrice pour les fans qui doutent (fil Vocaux, 17/10) | Requête du bouton micro natif (upload, format et codec, durée max), import d'un fichier audio dans « Envoyer des médias » et dans un bundle, rendu côté fan (lecteur avec onde ou fichier joint) |

## Ce que le bot envoie (Charles, 2026-10-17, 18h18)

Le bot n'envoie **jamais de média libre** : seulement du texte (E1), des étapes de scripts natifs dont les bundles sont préparés à l'avance (E3) et des notes (E4, E4b). E2 (bundle composé à la volée) n'est pas utilisé par l'agent ; FakeReveal le simule seulement pour lire l'historique. Seule exception, tranchée par Charles (17/10, 18h25) : les vocaux générés dans la voix de la créatrice (E7), toujours en copilote (chaque vocal écouté et approuvé par un humain avant l'envoi), avec le prénom du fan et des fréquences bornées par le code (fiche du fil Vocaux, PR #18).

Si Reveal ne permet pas de télécharger les originaux (L15), le repli est d'indexer les fichiers sources que l'agence possède déjà (ceux qu'elle a importés dans le Vault), avec une correspondance fichier ↔ étape de script faite à l'import.

## Jamais

Le connecteur n'appelle aucun endpoint qui supprime, rembourse, bloque un fan, envoie un message de masse, change un prix d'abonnement ou un réglage du compte. S'ils apparaissent dans la capture, ils sont notés dans `reveal-api-observed.md` sous « Non utilisés ».

## Effets sur le port

L5, L7 à L15, E3, E4 et E4b n'existent pas dans le port décrit par `docs/architecture/connectors.md`. Ce sont des méthodes **optionnelles**, annoncées par `capabilities` (`fanProfile`, `fanNotes`, `creatorNotes`, `ppvStats`, `platformScripts`, `vault`) : OnlyFans n'a pas de scripts natifs, notre plateforme les aura en interne, et le cœur s'adapte à ce que le connecteur déclare (ADR 0003). La forme exacte se fixe après la capture, dans la fiche proposée `docs/sessions/tasks/PROPOSED-reveal-connector.md`. Si le changement de contrat touche plusieurs modules, la session écrit une ADR `proposed`.

## Questions ajoutées aux 10 de `connectors.md`

11. **Scripts natifs** : liste, contenu (étapes, médias, prix, textes), trace de ce qui a été envoyé à un fan, endpoint d'envoi dédié ou non.
12. **Historique** : pagination de tout l'historique d'une conversation, des achats passés et des notes client (import initial, anti-doublon).
13. **Notes client** : lecture, écriture, format, concurrence avec un chatteur.
14. **Âge des fans** : Reveal vérifie-t-il l'âge, et l'expose-t-il.

## Observé à l'écran (captures de Charles, 2026-10-17)

Neuf captures d'écran de l'interface créatrice de Reveal, sans trafic réseau : elles disent ce que l'interface montre, pas encore quels appels le fournissent. Aucun pseudo, contenu ni donnée de persona n'est recopié ici.

### Navigation

Menu du compte : Statistiques, Profil, Boost, Stories, Publications, Informations, Messages, **Automatisations**, Abonnements, Liens de paiement, Mass DM, Listes, **Scripts**, **Vault**, Boudoir, Transactions, Liens de suivi. En haut : Dashboard, Classement, Affiliation, notifications, réglages, compte connecté.

- **Automatisations** : Reveal envoie peut-être déjà des messages seul (bienvenue, relances). À inventorier avant tout envoi par l'agent, sinon un fan reçoit deux messages.
- **Mass DM** apparaît dans les conversations comme un message ordinaire (promotion d'une autre créatrice, « SFS ») : le connecteur doit savoir le reconnaître pour ne pas y répondre comme à un échange.

### Boîte de réception (L2)

- Compteurs et filtres : Tous, épinglés, en ligne (point vert, nombre), Priorité (nombre), Non lu (nombre) ; recherche par pseudo ; filtre « Toutes les listes ».
- Ligne de conversation : avatar, **badge du total dépensé par le fan** (en €), pseudo, point de présence, aperçu du dernier message (« Vous avez envoyé un media »), date.
- Les non-lus et un aperçu sont donc visibles sans ouvrir la conversation (question 3, à confirmer dans le trafic).

### Conversation (L3, E1, E6)

- En-tête : pseudo, crayon (renommer le fan pour l'équipe), « Vu il y a environ 3 heures » (dernière présence), puis des actions à identifier : liste, épingler « Moi », **« Équipe »** (attribution à un chatteur ?), enveloppe (marquer non lu ?), cercle barré (bloquer ou masquer ?).
- **Chaque message sortant porte le nom du chatteur et l'heure** (« Prénom - JJ/MM/AAAA HH:MM »). Reveal attribue donc les envois par membre de l'équipe : c'est la base de l'attribution des ventes bot ou chatteur.
- Les **messages supprimés** restent visibles pour les admins (« Message supprimé - Visible uniquement par les admins ») : le connecteur doit les reconnaître et ne jamais les compter comme lus par le fan.
- Zone de saisie : bouton média (image), **bouton étiquette (bundle PPV, à confirmer)**, micro (message vocal), champ texte, emoji, **bouton bulle (scripts)**, envoyer. Une barre d'emojis rapides éditable au-dessus.

### Envoyer des médias (E2, gratuit)

Fenêtre « Envoyer des médias » : « Ajouter depuis le Vault » ou « Importer depuis l'ordinateur », puis « Sélectionner ».

### Bundle = PPV (E2)

Dans Reveal, un PPV s'appelle un **bundle**. Fenêtre « Ajouter un bundle » :

- **Prix TTC** ; la TVA est calculée selon la localisation du fan. **0 = offert** : le fan le voit sans payer.
- **Tarif réduit TTC** (interrupteur) : prix barré. L'agent ne l'utilise pas : Charles a tranché « jamais de négociation ni de remise » (17/10, `chatting/methode-chatting.md` du dossier partagé).
- **Contenu vendu** : médias **floutés tant que le fan n'a pas payé**, depuis le Vault ou importés. **Au moins un média, sinon l'envoi est refusé.**
- **Aperçu gratuit (teasing)** : optionnel, **10 médias au plus**, affichés non floutés dans un carrousel tant que le bundle n'est pas acheté. Ne jamais y mettre le contenu vendu.

Conséquences pour le port : `OutboundMedia` doit porter `priceCents` (TTC, devise EUR), `lockedMediaRefs` (≥ 1) et `teaserMediaRefs` (≤ 10). Les gardes en code vérifient ces bornes avant l'envoi (règle 3 de CLAUDE.md).

### Scripts (L8, L9, E3)

Le sélecteur s'ouvre depuis le bouton bulle de la zone de saisie. Le parcours de Charles : **choisir un script, puis une étape, puis envoyer**.

- Filtre « Tous » en haut (dossiers ou catégories, à confirmer), recherche « par nom ou message ».
- Chaque ligne est **une étape** : nom de l'étape (« Contexte », « Teasing », « Etape 1 : … »), texte du message (parfois « / » = pas de texte, média seul), prix (« Gratuit » ou montant), vignettes des médias (« +1 » au-delà de deux).
- La bibliothèque mélange étapes de vente et **réponses toutes faites** à des questions fréquentes (vrai prénom, pratique apprise seule…). L'agent peut s'en servir comme réservoir de faits de persona, pas seulement pour vendre.
- **Variable `%NAME%`** : remplacée par le « prénom du membre » saisi dans le panneau Analytics de la conversation. Si le prénom n'est pas rempli, le résultat est à vérifier (vide ? pseudo ?) : garde en code, ne jamais envoyer un `%NAME%` brut ni un prénom vide.
- Aucun indicateur « déjà envoyé » n'était visible sur les captures, parce qu'aucun script n'avait encore été envoyé à ce fan. Charles confirme (17/10) que Reveal indique bien un script déjà envoyé ou utilisé avec un fan : la règle « jamais deux fois le même script au même fan » s'appuie sur cet indicateur (ADR 0018).

### Vault (L10)

« Vault de \<créatrice\> », nombre de dossiers (28), bouton **SFS**, bouton +, recherche de dossier. Dossiers système verrouillés : Tous les médias, Feed, Mass DM, Message. Dossiers créés par l'agence, **un par script** (« SCRIPT \<thème\> | ☀️ » ou « | 🌙 »), plus des dossiers de récompense. Le lien script ↔ dossier du Vault est une convention de nommage, pas une donnée : à confirmer avec Charles (et le sens de ☀️ / 🌙).

### Panneau de droite, onglet Analytics (L5, L6, L7, L11, E4)

- Tuiles : **Abonnement (jours)**, **Tips**, **Messages** (€ dépensés en messages), **Boudoir** (€), **Médias entrants** (€), **Total dépensé**.
- Lignes : Dernier paiement, Achat le plus élevé, Statut d'abonnement (ex. Expiré), Renouvellement (ex. Désactivé), Date d'abonnement.
- **Prénom du membre** : champ dédié, source de `%NAME%`. C'est le premier slot KYC à remplir (`kyc_slot` prénom).
- **Notes** : texte libre structuré par un **canevas modifiable** (« Modifier le canevas ») ; le canevas de l'agence est : Prénom, Localisation, Âge, Métier, Passions, Envies, Situation. Ce sont les slots KYC d’Impera : l'agent remplit ce canevas, ligne par ligne, sans le casser.
- **Note du modèle** : texte libre (fiche de la créatrice : âge, nationalité, ville, mensurations…). Contient des données personnelles de la créatrice : jamais dans le dépôt, jamais dans un log (ADR 0010).
- Taux d'achat du fan : « x/y, n % des PPV envoyés ».

### Panneau de droite, onglet PPV (L13)

- Bascule **Payant / Gratuit**.
- **Taux d'achat** (achetés / envoyés, %), **Prix le plus élevé**, **Prix le plus bas** (des PPV envoyés à ce fan).
- **Historique PPV payant** : une carte par bundle envoyé, avec prix, cadenas (non acheté), date et heure, vignettes des médias. C'est la source de l'anti-doublon de médias et de l'échelle de prix par fan.

### Statistiques du compte (L6)

Vue modèle par jour, semaine, mois ou période, comparée à la période précédente : Revenu modèle, Volume TTC, CA HT, **Revenu agence**, projection sur 31 jours, nouveaux abonnés, ventes, panier moyen TTC, détail des revenus par jour et répartition. Mise à jour toutes les heures. Sert au suivi du CA du bot, pas au chatting.

### Décisions de Charles (2026-10-17, 17h52)

- **Fan test** : le compte de la conversation des captures est un compte test de Charles. C'est la seule cible des écritures pendant la capture et les essais (son abonnement doit être réactivé). Son pseudo ne va pas dans le dépôt : il se configure en variable d'environnement le moment venu.
- **Automatisations de Reveal** : ~~actives, mais sans effet sur le bot~~. Corrigé le 14/11 : accroche, bienvenue, réponse à une story, Mass DM et rappel d'expiration écrivent dans la conversation et changent ce que l'agent doit faire ; règles dans l'ADR 0110.
- **Membre d'équipe « bot »** (précisé à 18h06 : un chatteur Reveal = un nom + une adresse mail + sa propre session) : on crée dans Reveal un membre d'équipe dédié à l'agent, pour que ses messages portent son nom. Le connecteur utilise la session de ce membre, pas celle de Charles. Cela donne l'attribution des ventes bot ou chatteur, et une révocation possible sans toucher aux autres comptes.
- **Scripts de jour ☀️ et de nuit 🌙** : le suffixe du dossier dit si les médias ont été pris de jour ou de nuit. On vend « du temps présent » : le fan doit croire que le média vient d'être pris pour lui. Règle en code : un script ☀️ ne part qu'en journée, un script 🌙 qu'en soirée et la nuit, à l'heure de la créatrice (Europe/Paris par défaut). Les heures de bascule sont un réglage de la persona, pas une valeur en dur. Un script sans suffixe n'a pas de contrainte. Il reste à lire ce suffixe dans le nom du script lui-même s'il n'y figure pas (lien script ↔ dossier du Vault).
