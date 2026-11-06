# apps/extension

Extension Chrome (WXT, Manifest V3) à trois fonctions, livrées dans cet ordre :

1. **Enregistreur** (P1-01) : intercepte les appels réseau du client web Reveal, anonymise, exporte un JSON pour l'analyse de l'API.
2. **Capture de session** (P2) : bouton Sync qui envoie la session courante, chiffrée, au backend (`POST /v1/connector/sessions`, jeton d'appareil).
3. **Relais d'actions** (optionnel) : joue depuis l'onglet des actions que le backend ne peut pas faire seul.

Popup (ADR 0066) : on se connecte dans le CRM, jamais dans l'extension ; le popup lit `GET /v1/me` à l'adresse du CRM avec le cookie du navigateur (`HttpOnly`, jamais lu ni gardé), montre qui est connecté, l'onglet ouvert (Reveal, Instagram) et des raccourcis selon le rôle. Adresse du CRM réglable dans le popup (`chrome.storage.local`, par défaut `http://localhost:5173`) ; `localhost` est autorisé à l'installation, une autre adresse demande l'autorisation du navigateur pour ce site seul. Le manifeste porte une `key` publique (`manifest-key.pub.pem`, une clé publique, pas un secret) : l'ID reste `bbfemgjihdepnemmacfgdjoldmcpoahd` où que soit le dossier.

Interface : le popup utilise `@impera/design-system/styles.css` (`docs/design/README.md`, section Extension) ; aucun style injecté dans la page Reveal.

Contraintes : `host_permissions` limitées à `https://*.reveal.me/*` et au CRM local (`localhost`, `127.0.0.1`) ; service worker éphémère (`chrome.alarms`, pas de `setInterval`) ; aucun secret de connexion stocké dans l'extension (`chrome.storage.local` garde l'adresse du CRM et, pour la veille, le code de liaison décrit plus bas) ; aucun appel LLM depuis l'extension.

## Veille Instagram (VEI-02, ADR 0060 § 2, source 6)

Sur un onglet instagram.com, la popup du propriétaire et des managers montre la carte « Veille Instagram ». Dans l'ordre :

1. **Relier** : on colle une fois le code de « Relier l'extension » (CRM, Sécurité). Il est gardé dans `chrome.storage.local` (clé `watchLink`), lu par le service worker seul (le navigateur n'interdit pas cette zone aux scripts de contenu de l'extension ; son seul script de contenu, le lecteur, n'y touche jamais, et `src/build.test.ts` le vérifie), envoyé dans l'en-tête `x-extension-link` avec `credentials: 'omit'`, jamais au lecteur ni à la page. Un 401 le marque retiré et la popup redemande un code.
2. **Autoriser** : `https://www.instagram.com/*` est une `optional_host_permissions`, demandée au premier clic (« Autoriser et lancer »), jamais à l'installation.
3. **Lancer la veille** : le service worker enregistre le lecteur (`watch.js`, script « unlisted » de WXT) par `chrome.scripting.registerContentScripts` : monde isolé, `allFrames: false`, `excludeMatches` sur `/direct/*`, `/stories/*`, `/accounts/*`. Ce n'est pas un content script du manifeste : le manifeste construit n'a ni `content_scripts` ni `web_accessible_resources`, et le wrapper des content scripts de WXT (`postMessage`, `dispatchEvent` sur le document) n'est pas embarqué. La veille s'arrête seule à 45 minutes (`chrome.alarms`, état dans `chrome.storage.session`), en quittant Instagram ou en fermant l'onglet.

Le lecteur (`src/lib/watch/`) ne fait que lire : `MutationObserver`, `IntersectionObserver`, et l'adresse lue toutes les 500 ms (pas d'événement de navigation, qui passerait par `dispatchEvent`). Pages lues : `/reels/`, `/reel/…`, `/p/…`, `/explore/`, profils publics ; jamais le fil d'accueil ni les messages. Une valeur absente vaut `null`, jamais 0. Il envoie ses relevés au service worker, qui les poste par lots de 50 (`POST /v1/trends/readings`) ; un test (`src/build.test.ts`) construit l'extension et refuse un `watch.js` qui contiendrait une requête, un défilement, un clic, un `dispatchEvent`, un `postMessage`, une insertion de nœud ou de style.

**Marquer** un post pour une créatrice : puces de la popup, menu contextuel sur le lien d'un post, ou Alt+Maj+M (la dernière créatrice choisie). Depuis la popup ou le raccourci, le service worker prend jusqu'à quatre captures de l'onglet visible (`tabs.captureVisibleTab`, JPEG, 1,5 s d'écart, arrêt dès que le post quitte l'écran) et les envoie à la vision (`POST /v1/trends/readings/captures`), sans les écrire nulle part. Badge : « • » pendant la veille, « ! » ambre quand la page ne donne plus rien ; jamais de rechargement.

Chargement en dev : `pnpm --filter @impera/extension dev` (serveur de dev WXT sur le port 3100, le 3000 étant celui de l'API), puis `chrome://extensions` → mode développeur → charger `.output/chrome-mv3-dev`.

Icônes : `public/icon/<taille>.png`, rendues depuis `brand/` sans retouche : 16 depuis `favicon.svg`, 32 et 48 depuis `impera-mark-small.svg`, 128 depuis `impera-mark.svg` (le verre) ; WXT les met dans le manifeste. `public/icon/mark.svg`, l'en-tête du popup, est `impera-mark-small.svg`. Paquet à installer ou à publier : `pnpm --filter @impera/extension zip` (`.output/impera.zip`). L'image du CRM le fabrique et le sert à `/extension/impera.zip` ; le guide de l'équipe est `/aide/extension` (ADR 0067).
