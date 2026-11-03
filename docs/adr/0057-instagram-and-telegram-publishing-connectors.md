# 0057. Instagram et Telegram : deux connecteurs de publication, par les API officielles, dans le même plan que le feed

Statut : proposed (demande de Charles du 03/11/2026, 9 h 42 ; « ça serait bien du coup de faire les connecteurs Telegram et les connecteurs Instagram pour que ça publie automatiquement », 9 h 53 ; précisions sur Telegram, 9 h 58 ; fil « Repenser le workflow médias et scripts de la modèle »)
Date : 2026-11-03
Précise : l'ADR 0003 (un connecteur de publication est un adaptateur, comme un connecteur de plateforme), l'ADR 0044 § 3 et § 4 (le plan de la semaine et la mesure couvrent ces sorties), l'ADR 0055 (catégories `instagram_story`, `instagram_reel`, `instagram_post`, `telegram_post`), l'ADR 0016 (jetons scellés), l'ADR 0042 § 2 (droit de regard, renforcé ici pour Instagram).

## Contexte

Charles veut publier automatiquement sur le compte Instagram de la créatrice (Reels surtout, stories, photos de feed) et sur son canal Telegram d'actualité, avec des légendes écrites pour elle, sur lesquelles elle a son mot à dire.

Instagram et Telegram sont des **sources d'acquisition** : le but est d'amener du monde sur Reveal. Pour Telegram, Charles a précisé (03/11, 9 h 58) : une vidéo de la créatrice avec une légende dans sa voix, qui donne envie de venir sur Reveal « d'une manière qui leur semble naturelle, pour papoter avec elle » (gratuit, elle s'ennuie…) ; le ton exact se travaillera plus tard, sur ses exemples.

Vérifié le 03/11 (documentation de Meta et d'outils qui publient par son API) :

- L'API officielle d'Instagram publie, sur un compte professionnel, des photos (JPEG seulement), des carrousels jusqu'à 10 éléments, des Reels et des stories. Par la voie « Instagram Login », elle ne demande pas de page Facebook.
- Quota : de l'ordre de 50 publications par 24 heures glissantes (la documentation de Meta dit 50 à un endroit, 100 à un autre).
- Meta lit chaque fichier à une **adresse publique** au moment de la publication.
- L'API ne fait pas : la musique sous licence par la voie Instagram Login (seulement par la voie Facebook Login avec une page liée, et Meta peut refuser le titre) ; les stickers de story (lien, sondage, lieu) ; le texte d'une story ; les filtres ; la suppression d'une publication.
- Instagram interdit la nudité et la sollicitation sexuelle, et restreint les comptes qui renvoient vers des plateformes adultes. L'automatisation non officielle (navigateur piloté, bibliothèques qui imitent l'application) fait fermer des comptes.
- L'API des bots Telegram publie dans un canal dont le bot est administrateur : photo, vidéo, album, texte ; 50 Mo par fichier par l'API standard.

## Décision

### 1. Des connecteurs de publication

- Un **connecteur de publication** (`publishing_connector`) est un adaptateur, à côté des connecteurs de plateforme, dans le module `connectors` : un port à lui (publier une photo, un carrousel, une vidéo, un Reel, une story ; lire les statistiques d'une publication ; dire ce qu'il sait faire par des drapeaux, comme l'ADR 0018). Le cœur ne connaît ni la forme d'Instagram ni celle de Telegram (ADR 0003). Chacun a son faux pour les tests (`FakeInstagram`, `FakeTelegramChannel`), écrit d'abord.
- **Seules les API officielles** sont permises. Aucune automatisation de navigateur, aucune bibliothèque non officielle, pour aucun réseau.

### 2. Le branchement

- Instagram : le compte **professionnel de la créatrice** (pas un compte de l'agence) est branché par le propriétaire dans Réglages › Créatrices, par la connexion officielle d'Instagram, au travers d'une application Meta de l'agence. Le jeton est scellé comme les autres clés (ADR 0016), jamais dans le dépôt, un `.env` ou un fil de discussion ; son expiration passe en ambre avant la date.
- Telegram : le bot de Nirvana est ajouté par l'agence comme administrateur du canal de la créatrice ; le propriétaire indique le canal dans Réglages. Le jeton du bot est celui des alertes (ADR 0016), aucun second bot.

### 3. Dans le plan de la semaine

- Les dépôts de ces catégories entrent dans le plan de la semaine de l'ADR 0044 § 3 : nombre par jour et heures réglés par sortie, plus anciens d'abord, acceptation d'un geste par le propriétaire ou un manager, modification d'une publication (média, légende, heure).
- Chaque publication part avec sa clé d'idempotence. Un échec ne republie jamais à l'aveugle : pour Instagram, le connecteur relit l'état du conteneur avant toute reprise ; sinon, la publication passe en ambre avec sa raison.
- Le quota Instagram est compté par le code ; le plan ne le dépasse jamais.
- Les statistiques que l'API donne (vues, j'aime, commentaires, partages ; vues d'un message Telegram) sont lues à 48 h et suivent l'ADR 0044 § 4.

### 4. Les fichiers

- Pour Instagram, le connecteur crée une **adresse signée de courte durée** (une heure au plus) vers une copie convertie (JPEG, vidéo aux formats de Meta), la donne à Meta, et l'efface après la publication. Chaque adresse créée entre au journal.
- Pour Telegram, le fichier est envoyé directement par le serveur, compressé sous 50 Mo si besoin.
- La conservation suit l'ADR 0055 § 7.

### 5. Les Reels et le son

- Un Reel part en mode **automatique** (avec son son d'origine) ou en mode **assisté**, au choix de l'agence pour chaque publication. En mode assisté, à l'heure prévue, la personne désignée (la créatrice ou un membre de l'agence) reçoit une notification avec la vidéo prête et la légende copiée, ajoute un son dans Instagram et publie elle-même ; elle marque « Publié » dans Nirvana. C'est la seule façon propre d'avoir un son tendance.

### 6. Les légendes

- Le modèle de langage écrit les légendes dans la voix de la créatrice, avec les gardes de voix existantes, un prompt versionné par sortie et un schéma de sortie. Il ne choisit ni le média, ni l'heure, ni la sortie.
- **Garde Instagram, dans le code** : aucune mention d'une plateforme adulte, d'un lien, d'un prix ou d'un « lien en bio », cinq mots-clés au plus, longueur bornée. Une légende qui ne passe pas est refusée et réécrite une fois, puis passe en ambre ; elle ne part jamais telle quelle.
- **Telegram** : la légende vise à faire venir sur Reveal ; le lien vers sa page Reveal est permis. Elle ne dit rien de faux sur le prix (l'abonnement gratuit est vrai), ne promet ni amour ni rencontre, ne montre rien de nu (méthode de chatting). Le ton et les ressorts viendront des exemples de Charles, dans un prompt versionné, avant le code de ce lot.

### 7. Le mot de la créatrice

- Reveal et Telegram : son droit de regard, jamais obligatoire (ADR 0042 § 2).
- **Instagram : son accord par défaut**, réglable par l'agence pour chaque créatrice. La veille, une notification lui dit ce qui part le lendemain ; elle accepte ou corrige chaque légende. Sans réponse deux heures avant l'heure prévue, la publication **attend** au lieu de partir, et l'agence le voit en ambre. Sa correction passe par la même garde Instagram.

### 8. Les agents externes

- Un agent connecté par le MCP (ADR 0026) peut lire le plan de diffusion et les statistiques, et **mettre en pause** une publication : c'est freiner, l'ADR 0026 le permet déjà. Publier, ou écrire dans le plan, relève de l'ADR 0058.

## Conséquences

Positives :
- Instagram et Telegram sont nourris sans que personne ne poste à la main, dans le même plan et avec la même acceptation que le feed.
- Le compte Instagram de la créatrice est protégé par le code : API officielle, garde de légende, quota, son accord.

Négatives, à surveiller :
- Pas de son tendance en automatique : les Reels qui en ont besoin restent assistés.
- Une application Meta peut demander une revue de Meta pour sortir du mode développement ; tant qu'elle publie sur des comptes qui y ont un rôle, ce n'est pas nécessaire. À vérifier à la création, et une ADR si la revue devient obligatoire.
- Une publication Instagram ne se supprime pas par l'API : une erreur se retire à la main dans l'application.
- Une adresse publique, même brève, expose un fichier : copie convertie seulement, durée courte, effacement, journal.

## Alternatives rejetées

- **Bibliothèques non officielles ou navigateur piloté** : elles font fermer les comptes, et le compte Instagram est la source d'acquisition de la créatrice.
- **Un service tiers de publication** (outil qui publie pour nous) : un fournisseur de plus qui verrait les médias, pour un gain faible ; l'API officielle suffit.
- **Publier sur Instagram sans l'accord de la créatrice** : c'est son visage public, souvent un compte que ses proches voient.
- **La voie Facebook Login pour avoir la musique** : demande une page Facebook liée et des droits plus larges, pour un son que Meta peut refuser ; à revoir par une ADR si le mode assisté ne suffit pas.
