# apps/extension

Extension Chrome (WXT, Manifest V3) à trois fonctions, livrées dans cet ordre :

1. **Enregistreur** (P1-01) : intercepte les appels réseau du client web Reveal, anonymise, exporte un JSON pour l'analyse de l'API.
2. **Capture de session** (P2) : bouton Sync qui envoie la session courante, chiffrée, au backend (`POST /v1/connector/sessions`, jeton d'appareil).
3. **Relais d'actions** (optionnel) : joue depuis l'onglet des actions que le backend ne peut pas faire seul.

Interface : le popup utilise `@nirvana/design-system/styles.css` (`docs/design/README.md`, section Extension) ; aucun style injecté dans la page Reveal.

Contraintes : `host_permissions` limitées à `*://*.reveal.me/*` ; service worker éphémère (`chrome.alarms`, pas de `setInterval`) ; aucun secret stocké dans l'extension (`chrome.storage.session` au plus) ; aucun appel LLM depuis l'extension.

Chargement en dev : `pnpm --filter @nirvana/extension dev` (serveur de dev WXT sur le port 3100, le 3000 étant celui de l'API), puis `chrome://extensions` → mode développeur → charger `.output/chrome-mv3-dev`.

Icônes : `public/icon/<taille>.png` (16, 32, 48, 128), tirées de `brand/favicon.svg` sans retouche ; WXT les met dans le manifeste. Paquet à installer ou à publier : `pnpm --filter @nirvana/extension zip` (dans `.output/`).
