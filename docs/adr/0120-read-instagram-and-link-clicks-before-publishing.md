# 0120. Lire avant de publier : les statistiques du compte Instagram et les clics des liens de redirection, le retour sur un Reel, l'entonnoir d'acquisition

Statut : accepted (Charles, 16/11/2026, 2 h 05, « ok 0120 » ; demande de Charles du 16/11/2026, 2 h 01 : « tu peux commencer déjà à développer, à ajouter le connecteur à Meta » et celui du service de redirection ; fil « Imaginer le système Instagram »)
Date : 2026-11-16
Précise : l'ADR 0057 (§ 1 : le port du connecteur de publication lit déjà les statistiques ; § 2 : le branchement ; § 3 : les statistiques à 48 h), l'ADR 0060 (§ 2, source 1 : les statistiques du compte de la créatrice), l'ADR 0080 (le lien de redirection), l'ADR 0082 (§ 1 : la médiane du compte), l'ADR 0042 (ce que la créatrice voit), l'ADR 0016 (clés scellées). Amende : l'ADR 0057 § 2, où le branchement d'Instagram demandait d'emblée le droit de publier ; l'ADR 0060 § 2, où la lecture des statistiques attendait la publication (VEI-05 dépendait de PUB-02).

## Contexte

Tout ce qui touche à Instagram est bloqué par une même chose : le compte professionnel de la créatrice n'est pas encore branché (PUB-02, VEI-05, PUB-03). Or brancher pour **lire** ne présente aucun risque pour le compte, alors que publier engage son visage public et demande son accord (ADR 0057 § 7). Rien n'oblige à attendre la publication pour mesurer.

Charles veut aussi relier Instagram à ce qu'il rapporte. Un Reel ne porte pas de lien : le fan passe par un lien de redirection (ADR 0080) placé dans une story. Le service de redirection de l'agence expose une API en lecture : pages vues et clics par lien, par heure, avec, pour chaque visite, un drapeau « robot ».

Vérifié le 16/11/2026 (documentation de Meta, journal des changements mis à jour le 05/10/2026) :

- Avec la connexion « Instagram Login », l'application Meta de l'agence lit un compte professionnel **sans page Facebook**. En accès standard, elle sert les comptes qui ont un rôle sur l'application, sans revue de Meta. C'est la titulaire du compte qui fait la connexion et accorde les droits.
- Par média, l'API donne des nombres : vues, portée, j'aime, commentaires, partages, enregistrements, republications, taux de zapping d'un Reel. Elle ne donne ni la durée de visionnage ni la courbe de rétention.
- Elle liste les médias du compte, y compris ceux publiés à la main depuis l'application, et les stories en ligne.
- Le service de redirection ne connaît pas la provenance de la plupart des visites : l'application Instagram la masque. La provenance ne peut donc pas servir à attribuer un clic.

## Décision

### 1. Brancher pour lire d'abord

- Le compte Instagram d'une créatrice se branche en **deux temps**. Le premier ne demande que les droits de lecture (profil, médias, statistiques). Le droit de publier est demandé plus tard, par un second accord, quand PUB-02 arrive ; rien d'autre de l'ADR 0057 § 2 ne change : application Meta de l'agence, connexion officielle faite par la créatrice, jeton scellé (ADR 0016), jamais dans le dépôt, un `.env` ou un fil de discussion, expiration en ambre.
- La lecture passe par le port du connecteur de publication (ADR 0057 § 1), qui dit ce qu'il sait faire par ses drapeaux : un compte branché en lecture seule n'a pas le drapeau de publication, et le plan de la semaine ne lui propose rien.
- `FakeInstagram` est écrit d'abord et couvre la lecture. Aucun appel réel dans un test.
- Seule l'API officielle est permise (ADR 0057 § 1, ADR 0060 § 1) : aucun agent ne navigue sur Instagram.

### 2. Ce qui est lu, et gardé

- Chaque nuit, et une heure après une publication connue, le connecteur lit les médias du compte et leurs statistiques. Un **relevé** (`media_insight_snapshot`) est gardé par média et par âge : 1 heure, 24 heures, 48 heures, 7 jours. Le couple média et âge est unique : un job rejoué n'écrit rien deux fois. Un âge est un **palier** : le relevé gardé est la première lecture faite après cet âge, avec l'heure réelle de la lecture ; une lecture plus tardive ne le remplace pas.
- Les stories en ligne sont relevées par leur identifiant, leur heure et leurs nombres, pour savoir si la journée a sa story (les rappels relèvent d'une ADR à venir).
*Avenant du 20/11/2026, accepté par Charles (carte de décision, 20/11, 12 h 35 heure de Paris : « Marquer le relevé comme manqué »). Il remplace la règle du palier ci-dessus (« la première lecture faite après cet âge ») :*

- Un palier a une **fenêtre** : de son âge jusqu'au palier suivant (1 heure : jusqu'à 24 heures ; 24 heures : jusqu'à 48 heures ; 48 heures : jusqu'à 7 jours ; 7 jours : jusqu'à 14 jours). Une lecture remplit le palier dont la fenêtre contient l'âge du média au moment de la lecture, s'il n'a pas déjà son relevé. Elle remplit donc au plus un palier.
- Un palier dont la fenêtre est passée sans lecture est **manqué** : sa ligne est gardée sans aucun nombre. Un chiffre lu plus tard n'y entre jamais : rangé dans la case « 1 heure », un chiffre lu à trois jours fausserait la comparaison entre deux Reels et le retour écrit pour la créatrice.
- Un palier gardé, relevé ou manqué, n'est jamais remplacé. Le couple média et âge reste unique.
- Un calcul qui a besoin d'un palier manqué ne l'invente pas : il dit que le relevé manque.

- **Des nombres seulement.** Jamais le texte ni le nom d'un commentateur (ADR 0010), jamais un message privé. La légende et le format de ses propres médias sont lus.
- La lecture nourrit la source 1 de l'ADR 0060 § 2 sans attendre la publication : VEI-05 ne dépend plus de PUB-02.

### 3. Le connecteur de liens

- Un **connecteur de liens** (`link_stats_connector`) est un adaptateur en **lecture seule** sur l'API du service de redirection, dans le module `connectors`, avec son faux (`FakeLinkStats`) écrit d'abord. Il ne crée, ne modifie ni ne supprime jamais un lien : son port n'a aucune méthode d'écriture.
- Sa clé est saisie par le propriétaire dans Réglages et scellée comme les autres (ADR 0016).
- **Les hôtes de sortie sont écrits dans le code** (ADR 0113 § 2) : le connecteur de liens et l'adaptateur Instagram n'appellent que les hôtes écrits dans leur adaptateur, jamais un hôte tiré d'un réglage. Seule la clé vient des Réglages. Tout ajout d'hôte passe par une PR relue par Sécurité.
- Un lien de redirection (ADR 0080) porte désormais son **endroit** (`placement`), choisi dans une liste fermée : story à la une, story du jour, canal Telegram, autre réseau. Un lien enregistré avant cette ADR n'a pas d'endroit : l'écran affiche « à renseigner », et aucune attribution n'est fabriquée. C'est l'endroit, et non la provenance, qui attribue un clic ; l'écran recommande un lien par endroit.
- Le connecteur relève, par lien et par heure, les pages vues et les clics. Le total d'une heure est unique par lien et par heure UTC : tant que l'heure n'est pas close, une nouvelle lecture le remplace ; une fois close, il est figé. Les visites marquées « robot » par le service sont **retirées par le code** avant tout calcul, et leur part est montrée à l'agence.
- **Aucune donnée de visiteur n'est gardée** : ni adresse, ni ville, ni appareil d'une visite. Seuls des totaux par heure entrent en base.

*Avenant du 20/11/2026, accepté par Charles (carte de décision, 20/11, 22 h 28 heure de Paris : « Hors du dépôt, dans le déploiement » ; relu par le fil Sécurité). Il remplace, pour le seul connecteur de liens, la règle « les hôtes de sortie sont écrits dans le code » :*

- Le dépôt est public, et le nom de l'hôte du service de redirection dit quel outil l'agence utilise : **il n'entre pas dans le dépôt**. Ce que la règle protège reste tenu autrement : personne ne peut changer l'hôte depuis le CRM, et la clé ne part nulle part ailleurs.
- 1. L'hôte vient de la configuration du déploiement, jamais d'un réglage du CRM, d'une table ni d'une requête. Le changer est un geste de déploiement, fait par le propriétaire.
- 2. Hôte **absent** : le connecteur de liens est éteint, en ambre, et rien d'autre ne casse. Hôte **présent mais invalide** : le serveur refuse de démarrer. Est valide : `https`, un nom de domaine en ASCII, le port par défaut ; ni adresse IP, ni `localhost`, ni identifiants, ni chemin.
- 3. L'adaptateur n'appelle que cet hôte, ne suit aucune redirection, et n'envoie la clé qu'à lui.
- 4. Le dépôt ne porte qu'un hôte d'exemple dans les tests et un nom neutre dans `.env.example` ; le code, les commentaires et les documents disent « service de redirection ».
- 5. Ni l'hôte ni la clé n'apparaissent dans un journal, un message d'erreur, une réponse de l'API ou l'audit. Une erreur du service se rapporte comme « service de redirection indisponible », sans son adresse.
- L'adaptateur Instagram n'est pas concerné : ses hôtes sont ceux de Meta, publics, et restent écrits dans le code.

### 4. Le retour sur un Reel

- Pour chaque Reel relevé à 48 heures, le code calcule des **faits** : l'écart à la médiane du compte (règle de l'ADR 0082 § 1), les partages, enregistrements et j'aime rapportés à la portée, le taux de zapping, chacun comparé à sa médiane.
- Le modèle de langage écrit, à partir de ces seuls faits, un **retour** (`reel_review`) : trois lignes au plus et une leçon. Un retour qui cite un chiffre qu'il n'a pas reçu est refusé (comme l'ADR 0082 § 1). Il présente une cause comme une piste, jamais comme une certitude. Les gardes de voix et la garde Instagram s'appliquent.
- **La créatrice lit son retour directement** (décision de Charles du 16/11) : ce sont ses propres résultats, pas la veille (ADR 0042). Les mots sont les siens : jamais « score », « signal », « médiane » ni « IA ». L'agence voit le même retour avec les faits chiffrés.
- Sous cinq Reels relevés, aucun retour n'est écrit : la médiane ne veut rien dire.

### 5. L'entonnoir d'acquisition

- L'agence, et elle seule, voit un **entonnoir d'acquisition** (`acquisition_funnel`) par créatrice et par jour : vues de ses publications, clics par endroit, nouveaux abonnés de la plateforme, ventes. Les deux derniers viennent des données déjà lues par le connecteur de plateforme.
- Le rapprochement entre un Reel et les clics des heures suivantes est montré comme un **indice**, avec ce mot à l'écran. Aucune règle du code ne se fonde sur lui avant qu'une ADR le décide.

### 6. Les alertes

- Ambre : un jeton qui expire sous sept jours, une lecture qui échoue deux nuits de suite.
- Rouge : un lien d'endroit « story » sans aucun clic pendant 24 heures alors qu'il en recevait chaque jour de la semaine passée.

## Ce que cette ADR ne décide pas

La publication, les Reels d'essai, la règle de réplication, les réponses aux commentaires, le calendrier de contenu et les rappels : une ADR à venir, après ce lot.

## Conséquences

Positives :
- Instagram se mesure dès que le compte est professionnel, sans attendre la publication ni l'accord sur les légendes.
- Les idées peuvent être classées par ce qu'elles rapportent, pas seulement par leurs vues.
- Le risque pour le compte est nul : lecture seule, API officielle, aucun contenu envoyé.

Négatives, à surveiller :
- Deux accords successifs de la créatrice (lire, puis publier) au lieu d'un.
- L'attribution reste une estimation : un lien par endroit dit d'où vient un clic, pas quel Reel l'a provoqué.
- Un fournisseur de plus à suivre : l'API du service de redirection peut changer sans prévenir ; le connecteur échoue alors en ambre, sans rien casser d'autre.
- Deux tables nouvelles et un job de nuit par créatrice.

## Alternatives rejetées

- **Attendre PUB-02 pour tout brancher d'un coup** : des semaines sans mesure, pour un risque que la lecture n'a pas.
- **Attribuer les clics par leur provenance** : elle est absente de la plupart des visites.
- **Garder le journal des visites** : des données personnelles de visiteurs, sans usage que les totaux ne couvrent.
- **Un outil d'analyse tiers branché sur le compte** : un fournisseur de plus qui verrait le compte, et aucun ne connaît les ventes de la plateforme.
- **Laisser le modèle expliquer un Reel librement** : il inventerait des chiffres et des causes ; le code fournit les faits.
