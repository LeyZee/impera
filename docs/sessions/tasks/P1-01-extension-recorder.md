# P1-01 Extension : enregistreur d'API

Statut : superseded (relevé du 27/11/2026, décidé par Charles sur recommandation du fil « Remettre la documentation au propre » : l'API Reveal a été relevée par la capture de l'extension et l'API CRM officielle, voir « Reveal à deux voies ») ; statut précédent : todo
Phase : 1
Dépend de : P0-01
Branche : task/p1-01-extension-recorder

## Objectif
Une extension WXT, désactivée par défaut, qui enregistre les appels réseau du client web Reveal (fetch, XHR, WebSocket) en les anonymisant, et exporte un fichier JSON analysable en P1-02.

## Contexte à lire
`docs/architecture/connectors.md` (extension, contraintes MV3), `apps/extension/README.md`, `security.md` §5 (permissions).

## À faire
- Manifeste MV3 : `host_permissions` `*://*.reveal.me/*` seulement ; pas de `<all_urls>`.
- Script main world (`world: 'MAIN'`) qui enveloppe `fetch`, `XMLHttpRequest`, `WebSocket` et poste les métadonnées au content script : méthode, URL (paramètres conservés), en-têtes de requête (sauf `Cookie`/`Authorization` : remplacés par `<redacted:len>`), corps de requête et de réponse **tronqués à 2 Ko** et **anonymisés** (toute chaîne qui ressemble à un identifiant numérique long ou UUID est hachée de façon stable ; emails et téléphones masqués), horodatage, durée.
- Content script → service worker via `chrome.runtime.sendMessage` ; stockage en `chrome.storage.session` (jamais `local`), `chrome.alarms` pour le flush, pas de `setInterval`.
- Popup : interrupteur « Enregistrer » (off par défaut, s'éteint à la fermeture de l'onglet), compteur, bouton « Exporter » (fichier JSON téléchargé), bouton « Effacer ».
- Aucune communication réseau sortante de l'extension dans cette fiche.
- README de l'extension : comment charger en mode développeur, comment enregistrer une session de 10 minutes représentative (ouvrir la liste, ouvrir une conversation, envoyer un message, recevoir un message, consulter les ventes).

## Critères d'acceptation
- Test unitaire de l'anonymiseur : identifiants hachés de façon stable, emails/téléphones masqués, `Cookie` jamais présent dans l'export.
- Chargement sans erreur dans Chrome ; enregistrement d'une session sur un site de test (FakeReveal ou page locale) produit un export conforme au schéma `RecordingSchema` (dans `packages/contracts`).
- `web-ext lint` (ou l'équivalent WXT) sans avertissement de permission.

## Hors périmètre
Capture de session, relais d'actions, analyse.

## Notes de session
