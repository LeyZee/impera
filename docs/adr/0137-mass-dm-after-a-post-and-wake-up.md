# 0137. Le Mass DM part seul : une annonce après chaque publication du feed, un réveil quand plus personne ne parle, aux seuls fans silencieux

Statut : accepted (Charles, 16/11/2026, 16 h 13 Paris, « ok 0137 » ; demande du même jour, 15 h 50, fil « Publier posts et stories automatiquement »)
Date : 2026-11-16
Amende : ADR 0044 § 5 (le Mass DM ne part plus seulement d'un dépôt Relance : il peut être un texte qui accompagne une publication).
Précise : ADR 0110 § 5 et § 6 (Mass DM marqué « envoyé à tous », pas de relance de l'agent dans les 6 h), ADR 0136 (publication du feed), ADR 0126 (silence pendant un live).

## Contexte

Charles envoie un Mass DM à chaque publication du feed : « regarde ce que je viens de poster, tu en penses quoi ? ». C'est une relance naturelle des fans qui ne parlent plus. Ses règles : seulement aux abonnés et anciens abonnés, et seulement à ceux qui n'ont pas d'échange de messages récent. Il veut aussi un Mass DM de réveil quand il n'y a plus assez de fans actifs (« coucou toi, tu es là ? »).

Un Mass DM est un envoi réel à de vrais fans, en nombre. Il passe donc par les gardes du chatting, pas seulement par celles de la publication.

La capture du 16/11 (lue pour sa forme seulement) montre : la création d'un Mass DM programmé (texte, médias, prix, listes incluses et exclues), sa suppression, une estimation de l'audience par filtres (abonnés actifs, dépense, ancienneté, en ligne, renouvellement coupé), et les listes de fans (statiques ou dynamiques, ajout d'un fan à une liste statique). Elle ne montre ni filtre « anciens abonnés », ni filtre « sans échange récent », ni le retrait d'un fan d'une liste.

## Décision

### 1. Deux Mass DM automatiques

- **Annonce** : un Mass DM par publication du feed (ADR 0136), jamais pour une story. Il part **30 minutes après que Reveal a confirmé la publication**, jamais avant. Un index unique (publication → Mass DM) garantit qu'une publication n'en a jamais deux.
- **Réveil** : il part quand, pendant les heures d'activité de la créatrice, **moins de 5 fans ont écrit dans les 3 dernières heures** (seuil et fenêtre réglables par créatrice). Au plus un réveil tous les 3 jours, jamais le jour d'une annonce.

### 2. Qui le reçoit : une liste tenue par le code

- Reveal ne sait pas filtrer « sans échange récent » : le code calcule la liste lui-même, puis la donne à Reveal comme **liste statique** créée pour ce Mass DM (`POST /fan-lists`, puis un ajout par fan), avec le nom « Impera · annonce · date » ou « Impera · réveil · date ».
- Un fan y entre s'il est **abonné ou ancien abonné** (selon ce que Reveal permet d'écrire) **et** qu'aucun message, ni de lui ni de la créatrice, n'a été échangé depuis **72 heures** (réglage par créatrice).
- Le code en **retire toujours**, en lisant le même état que l'agent et jamais une liste à part : un fan en doute d'âge (âge contesté ou mineur possible signalé) ; un fan en mode soin ou fragile, ou encore en sortie de soin (ADR 0088 § 7) ; un fan aux ventes gelées (dépendance ou difficulté, ADR 0132) ; un fan parti en plein sexto qui n'est pas revenu (l'agent attend son retour après une seule relance) ; un fan marqué « ne plus écrire » ou exclu des Mass DM dans Reveal ; un fan dont une conversation est tenue par un humain ou par l'agent en ce moment ; un fan au milieu d'un script ; un fan qui a reçu un Mass DM (de nous ou de Reveal) dans les 48 dernières heures ; un fan au rythme économe si l'ADR 0135 est acceptée.
- **Plafond par fan** : 3 Mass DM automatiques par semaine au plus, annonces et réveils compris.

### 3. Ce qu'il dit

- **Texte seul et gratuit**, écrit par le modèle de langage dans la voix de la créatrice, avec les gardes de voix. Annonce : il s'appuie sur la description de la publication (ADR 0083) et finit par une question (« j'ai sorti la lingerie rouge, t'en penses quoi ? »). Réveil : court et doux (« coucou toi, t'es là ? »).
- Le texte reste au plus suggestif, jamais explicite : des destinataires ont un âge non confirmé.
- Il passe par les mêmes gardes de voix que l'agent (`ai_disclosure` comprise), jamais par une liste propre au Mass DM. Le code refuse en plus : un prix, un lien, un média vendu, une promesse de rencontre, et une phrase déjà envoyée en Mass DM par cette créatrice dans les 30 derniers jours.
- Si Reveal refuse un Mass DM sans média, l'annonce prend **une photo de la publication qu'elle annonce** (déjà publique, gratuite). Un réveil ne porte jamais de média.
- Le prix d'un Mass DM automatique est toujours 0 : un Mass DM payant reste à la main (ADR 0044 § 5).

### 4. Ce que l'agent en fait

- Le Mass DM est marqué « envoyé à tous » dans le contexte de l'agent et n'est jamais cité comme un message personnel (ADR 0110 § 5). Une réponse du fan est traitée comme toute réponse.
- Aucune relance de l'agent ne part dans les 6 heures qui suivent (ADR 0110 § 6).
- Aucun Mass DM ne part pendant la fenêtre d'un live (ADR 0126), ni quand le Dashboard est sur « Arrêt ». Un Mass DM prévu dans ces moments est décalé ou abandonné, jamais envoyé en retard de plus de 3 heures.

### 5. Qui valide

- Même deux modes que l'ADR 0136 § 6. En **« À valider »** (par défaut, obligatoire pendant les deux premières semaines), le propriétaire ou un manager actif voit le texte, le nombre de destinataires et les exclusions avant d'accepter. En **« Automatique »** (propriétaire seul, journalisé), il part seul ; on peut le retirer tant qu'il n'est pas parti.
- **Le premier Mass DM réel** attend le mot écrit de Charles dans le fil qui l'exécute, qui nomme l'action et le compte, et il part vers **une liste qui ne contient que le compte fan « test »**.

### 6. Fiabilité

- Clé d'idempotence par Mass DM. Si la réponse de Reveal se perd, le code relit la liste des Mass DM avant toute nouvelle tentative et ne renvoie jamais à l'aveugle : ambre avec sa raison (ADR 0044 § 5).
- Les listes créées pour un Mass DM sont gardées dans Reveal avec leur nom daté ; leur nettoyage attend que la suppression d'une liste soit vue dans une capture.
- Un ajout de fan qui échoue retire ce fan de l'envoi : la liste envoyée est toujours celle que le code a vérifiée.

### 7. Mesurer

- Pour chaque Mass DM : nombre de destinataires, réponses dans les 24 h, achats dans les 48 h (le `totalIncome` de Reveal et nos transactions), fans qui se désabonnent dans les 72 h. Une alerte ambre se lève si les désabonnements après un Mass DM dépassent 2 % des destinataires.

### 8. Le connecteur

- Capacités facultatives du port (ADR 0044 § 6), d'après la capture du 16/11 : `createFanList`, `addFanToList`, `estimateMassDmAudience`, `sendMassDm` (texte, médias facultatifs, heure, listes incluses et exclues, prix 0), `deleteMassDm`, `listMassDms`. `FakeReveal` d'abord.

## Conséquences

Positives :
- Chaque publication relance les fans silencieux, sans travail à la main.
- Les fans en doute d'âge, fragiles ou déjà en conversation ne reçoivent jamais un message de masse.

Négatives, à surveiller :
- Un message de masse trop fréquent fait partir des fans : plafond par fan, alerte sur les désabonnements.
- Une liste par Mass DM, ajoutée fan par fan, fait beaucoup d'appels à Reveal : à mesurer sur le faux Reveal puis sur « test ».

## Alternatives rejetées

- **Laisser Reveal choisir les destinataires avec ses filtres** : ils ne savent pas exclure un fan en doute d'âge ni un fan qui parle en ce moment.
- **Un Mass DM avec média payant** : il resterait de la vente à l'aveugle, contraire à « relation avant vente ».
- **Un Mass DM pour chaque story** : trop fréquent.
