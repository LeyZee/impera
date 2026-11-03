# apps/extension

Extension Chrome (WXT, Manifest V3) à trois fonctions, livrées dans cet ordre :

1. **Enregistreur** (P1-01) : intercepte les appels réseau du client web Reveal, anonymise, exporte un JSON pour l'analyse de l'API.
2. **Capture de session** (P2) : bouton Sync qui envoie la session courante, chiffrée, au backend (`POST /v1/connector/sessions`, jeton d'appareil).
3. **Relais d'actions** (optionnel) : joue depuis l'onglet des actions que le backend ne peut pas faire seul.

Popup (ADR 0066) : on se connecte dans le CRM, jamais dans l'extension ; le popup lit `GET /v1/me` à l'adresse du CRM avec le cookie du navigateur (`HttpOnly`, jamais lu ni gardé), montre qui est connecté, l'onglet ouvert (Reveal, Instagram) et des raccourcis selon le rôle. Adresse du CRM réglable dans le popup (`chrome.storage.local`, par défaut `http://localhost:5173`) ; `localhost` est autorisé à l'installation, une autre adresse demande l'autorisation du navigateur pour ce site seul. Le manifeste porte une `key` publique (`manifest-key.pub.pem`, une clé publique, pas un secret) : l'ID reste `bbfemgjihdepnemmacfgdjoldmcpoahd` où que soit le dossier.

Interface : le popup utilise `@impera/design-system/styles.css` (`docs/design/README.md`, section Extension) ; aucun style injecté dans la page Reveal.

Contraintes : `host_permissions` limitées à `https://*.reveal.me/*` et au CRM local (`localhost`, `127.0.0.1`) ; service worker éphémère (`chrome.alarms`, pas de `setInterval`) ; aucun secret stocké dans l'extension (`chrome.storage.local` ne garde que l'adresse du CRM) ; aucun appel LLM depuis l'extension.

Chargement en dev : `pnpm --filter @impera/extension dev` (serveur de dev WXT sur le port 3100, le 3000 étant celui de l'API), puis `chrome://extensions` → mode développeur → charger `.output/chrome-mv3-dev`.

Icônes : `public/icon/<taille>.png`, rendues depuis `brand/` sans retouche : 16 depuis `favicon.svg`, 32 et 48 depuis `impera-mark-small.svg`, 128 depuis `impera-mark.svg` (le verre) ; WXT les met dans le manifeste. `public/icon/mark.svg`, l'en-tête du popup, est `impera-mark-small.svg`. Paquet à installer ou à publier : `pnpm --filter @impera/extension zip` (dans `.output/`).
