# 0066. Le popup de l'extension : la connexion est celle du CRM, l'extension ne garde aucun secret de connexion

Statut : accepted (Charles, 03/11/2026, 17 h 37, « ok 0066 » ; § 7 amendé pour l'aligner sur la liaison de VEI-01 : « ok phrases 0066 », 17 h 38 ; raccourcis du § 6 alignés sur le menu du CRM après la relecture d'Extension : « ok phrases 0066 », 18 h 09 ; raccourcis du § 6 lus dans la table partagée des menus : « ok phrases 0066 », 19 h 03 ; titre, contexte et § 7 amendés pour le jeton de liaison de veille gardé par l'extension (VEI-02 lot b) : « ok phrases 0066 », 06/11/2026, 15 h 47 ; demande de Charles du 03/11/2026, 17 h 11 : « quand on clique dessus, […] il faut que ça fasse un joli design avec se connecter, etc. Enfin, vraiment que l'extension soit fonctionnelle »)
Date : 2026-11-03
Précise : l'ADR 0008 (rôle de l'extension) et l'ADR 0062 § 8 (identifiant de l'extension non empaquetée). Ne remplace rien.

## Contexte

Le popup de l'extension affiche aujourd'hui le logo et une phrase : « Rien à faire ici pour l'instant ». Charles l'a chargée dans Edge et Chrome et veut un vrai popup : se connecter, savoir qui est connecté, et accéder à ce qui sert.

Trois contraintes existent déjà :

- **La connexion au CRM a deux facteurs** (ADR 0046) et des clés d'accès Face ID ou empreinte (ADR 0053). Une clé d'accès est liée au domaine du CRM : elle ne marche pas dans un popup d'extension, dont l'adresse est `chrome-extension://…`.
- L'extension ne garde aucun secret de connexion : ni mot de passe, ni code, ni cookie, ni session Reveal (ADR 0008). Seule exception, le jeton de liaison de veille du § 7, gardé dans `chrome.storage.local` et lu par le service worker seul, jamais par le script de contenu d'Instagram : il est révocable dans le CRM et ne sert qu'à envoyer des relevés.
- **L'API refuse toute écriture qui ne vient pas de l'adresse du CRM** (security.md § 6). Seul `POST /v1/connector/sessions` (la future capture Reveal) en est exempté, avec son jeton d'appareil.

## Décision

1. **On se connecte dans le CRM, jamais dans le popup.** Le bouton « Se connecter » du popup ouvre la page de connexion du CRM dans un onglet : mot de passe, code ou clé d'accès, appareil de confiance, tout reste comme aujourd'hui. Le popup ne demande jamais un mot de passe ni un code.
2. **Le popup lit la session du navigateur.** Il appelle `GET /v1/me` à l'adresse du CRM, avec le cookie que le navigateur garde déjà pour le CRM. Ce cookie est `HttpOnly` : l'extension ne le lit pas, ne le copie pas et ne le stocke pas. Connecté au CRM dans Edge, on est connecté dans le popup d'Edge ; déconnecté du CRM, le popup le dit. Une session qui doit d'abord activer son code (ADR 0046) est renvoyée au CRM.
3. **Se déconnecter** ouvre le CRM, où se trouve le bouton. Le popup n'écrit rien dans l'API : aucune route ne change, aucune origine ne s'ajoute à la liste de l'API ni à celle de Better Auth.
4. **L'adresse du CRM** se règle une fois dans le popup (« Adresse du CRM », par défaut `http://localhost:5173`). Elle est gardée dans `chrome.storage.local` : ce n'est pas un secret. L'extension a le droit de lire `localhost` dès l'installation ; pour une autre adresse (le CRM déployé), le navigateur demande l'autorisation pour ce site seul au moment où on l'enregistre (`optional_host_permissions`). Les droits sur Reveal ne changent pas.
5. **L'identifiant de l'extension est fixé** par une clé publique dans le manifeste (`key`), comme le demandait l'ADR 0062 § 8 avant tout usage de `chrome.storage` : l'adresse enregistrée survit à un déplacement du dossier. La clé privée qui va avec ne sert à rien pour une extension chargée à la main ; elle n'est gardée nulle part.
6. **Ce que montre le popup**, dans cet ordre :
   - en tête, le logo et « Impera », puis la personne connectée (initiales, nom, rôle : Propriétaire, Manager, Chatteur, Créatrice) ;
   - l'onglet ouvert : sur Reveal, une carte « Reveal » qui dit l'état de la capture de session ; sur Instagram, la place de la Veille (VEI-02, qui la remplira) ; ailleurs, rien ;
   - au plus quatre raccourcis vers le CRM, lus dans la table des menus que le CRM et l'extension partagent (`packages/contracts`) : chaque rôle y a son menu et ses raccourcis, et un test refuse un raccourci absent du menu de son rôle, pour qu'un raccourci n'ouvre jamais un écran qui refuse et qu'un écran ajouté au menu soit proposé au popup dans la même PR (propriétaire : Dashboard, Suivi, Équipe, Créatrices ; manager : Dashboard, Suivi, Équipe, Paie ; chatteur : Aujourd'hui, Suivi, Planning, Commissions ; créatrice : Aujourd'hui, Agenda, Ventes, Moi) ;
   - en pied, l'adresse du CRM et la version.
   Un CRM injoignable s'affiche en ambre avec l'adresse essayée et « Réessayer ». Rien n'est en rouge : le popup n'a pas d'urgence à montrer.
7. **Lire n'est pas écrire.** La session du CRM ne sert qu'à savoir qui est là et ce que le popup propose. Ce que l'extension enverra à l'API (relevés de veille, capture Reveal) passe par la liaison par personne de VEI-01 (« Relier l'extension » dans le CRM : jeton haché, révocable, limité à ces envois), jamais par le cookie du CRM. Le popup montrera l'état de cette liaison quand elle existera. La capture Reveal n'est pas dans ce lot : sa carte dit « Bientôt » tant que P2 n'est pas livrée, et « Synchroniser » ne sera proposé qu'au propriétaire. Le jeton se colle une fois dans la case « Relier » du popup. Délié dans le CRM, il ne sert plus à rien, et le popup propose de le recoller.
8. **Thème** : Nuit ou Jour selon le réglage du navigateur ou de l'ordinateur (`prefers-color-scheme`) ; le choix fait dans Réglages › Apparence du CRM appartient au site du CRM et l'extension ne peut pas le lire.

## Conséquences

- Aucun changement côté API ni base dans ce lot : la relecture de Bilan porte sur la lecture de `/v1/me`, le manifeste et l'articulation avec la liaison de VEI-01 (§ 7).
- Se connecter coûte un aller-retour vers l'onglet du CRM la première fois ; ensuite le popup s'ouvre déjà connecté tant que la session du CRM vit.
- Chaque navigateur a sa session : connecté dans Edge ne connecte pas Chrome.
- Un CRM déployé sur une autre adresse demande un clic d'autorisation du navigateur, une fois.
- Le menu du CRM et les raccourcis du popup ne sont plus tenus à deux endroits : la table vit dans `packages/contracts`, le CRM y lit son menu et sa barre du téléphone, le popup ses raccourcis.

## Alternatives écartées

- **Formulaire de connexion dans le popup** : il faudrait ouvrir l'API et Better Auth à l'origine `chrome-extension://…`, refaire le parcours du code dans 340 px, et les clés d'accès n'y marcheraient pas.
- **La liaison de VEI-01 pour savoir qui est connecté** : il faudrait relier l'extension avant même de voir le popup, et une liaison oubliée garderait un nom affiché après la déconnexion du CRM. Elle reste l'outil des envois (§ 7).
- **Droit de lecture sur tous les sites dès l'installation** : un avertissement alarmant à l'installation pour une seule adresse utile.
