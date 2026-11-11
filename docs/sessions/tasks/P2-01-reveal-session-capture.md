# P2-01 Capture de la session Reveal et vérifications V1, V2

Statut : in_progress
Phase : 2
Dépend de : P1-03
Branche : task/p2-01-reveal-session-capture

## Objectif
Le bouton « Sync » de l'extension envoie la session du membre « bot » au serveur, et deux vérifications en lecture seule prouvent qu'elle marche depuis le serveur (V1) et disent combien de temps elle vit (V2).

## Contexte à lire
`docs/reference/reveal-connector-spec.md` §§ 1, 2, 7 ; ADR 0008 ; `docs/runbooks/session-expired.md` ; ADR 0066 (popup, § 7 liaison) ; `conversations/infra/http/copilot-routes.ts` (lecture de `x-extension-link`) ; `docs/conventions/security.md` § 2 ; route `POST /v1/connector/sessions` (P0-06) ; `apps/extension/` (WXT).

## À faire
- Repérer où le tableau de bord de Reveal garde son jeton (stockage local, cookie du tableau de bord, mémoire) : Charles regarde dans les outils de développement **le nom** de la clé, jamais la valeur dans le chat. Le consigner dans `reveal-api-observed.md`.
- Extension : bouton « Sync » sur `dashboard.reveal.me`, qui lit le jeton, le membre et la modèle, compose la session de la spécification § 2, l'envoie à `/v1/connector/sessions`, puis oublie tout (rien dans `storage`). Charles choisit la modèle si le membre en voit plusieurs.
- Authentification de l'envoi par la liaison de l'extension (`x-extension-link`, ADR 0066 § 7) d'un propriétaire, à la place du jeton d'appareil `EXTENSION_DEVICE_TOKEN` (spécification § 2) ; le bouton n'apparaît qu'au propriétaire.
- Serveur : schéma Zod de la session Reveal dans `connectors/infra/reveal/` ; refus si `modelId` ne correspond pas au compte déjà relié.
- **V1 et V2, à la demande écrite de Charles seulement**, depuis le serveur ou une machine qui n'est pas son navigateur : `GET /models/:id` avec le jeton capturé. Noter le statut, la durée de vie (`exp` si JWT, sinon mesure sur plusieurs jours), la réponse quand le jeton ne vaut plus, et l'effet d'une connexion du membre « bot » ailleurs. Aucune écriture.
- Aide `/aide/reveal` (apps/web, propriétaire Extension) d'après le runbook.

## Critères d'acceptation
- Test de l'extension : la session envoyée a la forme de la spécification, rien ne reste dans le stockage de l'extension.
- Test du serveur : session stockée chiffrée, illisible sans la clé, jamais dans les logs ; `modelId` différent refusé.
- `reveal-api-observed.md` : V1 et V2 consignés (sans aucune valeur de jeton). Si V1 échoue : fiche `blocked`, ADR `proposed` pour C, P2-02 ne commence pas.

## Hors périmètre
Le client Reveal (P2-02), tout envoi.

## Notes de session
- 2026-11-11 (Bilan) : fait dans la première PR. Serveur : `RevealSessionSchema` (`infra/reveal/session.ts`), refus 422 d'une session illisible et 409 d'une autre modèle que celle déjà reliée, `GET /v1/connector/accounts` et `POST /v1/connector/sessions` par la liaison d'un propriétaire (401 sans liaison, 403 pour un autre rôle) ; `EXTENSION_DEVICE_TOKEN` retiré. Extension : le jeton est lu dans l'en-tête `Authorization` des requêtes de l'onglet Reveal (`webRequest`, le temps du clic) plutôt que dans le stockage du tableau de bord, ce qui rend inutile le repérage de la clé ; bouton « Synchroniser » par compte dans le popup, propriétaire seul ; rien gardé. Aide `/aide/reveal`. Captures Nuit/Jour du popup et de l'aide (PC, téléphone) jointes dans le fil Bilan.
- Reste : V1 et V2, à la demande écrite de Charles seulement (essai réel sur son PC : recharger l'extension, cliquer « Synchroniser » sur un onglet Reveal du membre « bot »). La fiche reste `in_progress` jusque-là.
