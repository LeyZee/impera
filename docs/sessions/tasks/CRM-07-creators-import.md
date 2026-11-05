# CRM-07 Importer les créatrices depuis Reveal, après revue du propriétaire

Statut : in_progress (a1 et b1 fusionnés ; a2a en PR ; ADR 0069 acceptée par Charles le 03/11/2026, 19 h 58)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01 (clé et `listModels`) ; rien d'autre
Branches : task/crm-07-a-creators-import-api, task/crm-07-b-creators-import-screen
Propriétaires proposés : Bilan (lot a : contrats, `connectors`, base) ; Extension (lot b : écran)

## Objectif

Avec la clé posée, le propriétaire relit les modèles Reveal sans lien, et en un clic relie chacune à une créatrice existante ou la crée. Rien ne se crée sans lui.

## Contexte à lire

ADR 0069 (tout), ADR 0050 § 3 et § 4, ADR 0054, ADR 0010 (aucune donnée réelle). Code : `connectors/infra/reveal-crm/adapter.ts` (`listModels`), `packages/db/src/schema/sales-feed.ts` (`sales_feed_models`, lignes mises de côté), `persona/infra/db/creator-directory.ts` (création d'une créatrice, `name_key` unique), `apps/web/src/settings/sales-feed/Links.tsx`.

## À faire

### Lot a (Bilan), en deux PR : a1 (contrat, import, écartées, migration 0112) puis a2 (photo, alertes)

- [x] (a1) `PlatformModel` gagne `status` (valeur inconnue lue `other`) et `avatarUrl` (`https` seulement, sinon `null`) ; schéma Zod de `/v1/models` mis à jour.
- [x] (a2a) Statut inconnu signalé (`sales_feed_signal` `unknown_value`, champ `status`, une fois), comme ADR 0050 § 3.
- [x] (a1) Proposition calculée par le code pour chaque modèle sans lien : `link` (pseudo d'un compte existant d'abord, puis nom par `creatorNameKey`), sinon `create` ; `preselected` seulement pour `validated` et actif (`domain/model-import.ts`).
- [x] (a1) Route propriétaire (mot de passe redemandé) « importer la sélection » : par ligne, créer créatrice + compte Reveal + lien (`linkedBy` : le propriétaire) ou relier ; idempotente sur l'identifiant du modèle ; nom déjà pris refusé ligne par ligne sans faire tomber le lot ; ventes mises de côté libérées comme un lien à la main.
- [ ] (a2b) Photo copiée dans notre stockage (pas d'adresse Reveal gardée comme source) ; la colonne `creators.avatar_key` existe depuis a1. Réencodée, rangée sous `creators/<id>/avatar` dans le stockage des médias, servie par une route de l'API (la CSP du CRM refuse toute autre origine).
- [x] (a1) État « écartée » d'une ligne, réversible : table `sales_feed_model_dismissals` (migration 0112, attribuée par le coordinateur).
- [x] (a2a) Modèle reliée disparue de `/v1/models` ou passée `banned` : signal `model_gone` ou `model_banned` une fois, Telegram Important sans nom, rien de supprimé. La liste est lue par la lecture des ventes, un quart d'heure au plus souvent (`sales_feed_model_sightings`, migration 0116).
- [x] (a2a) Compteur du badge lu en base : `GET /v1/settings/sales-feeds/new-models` (propriétaire).
- [x] (a1) Journal d'audit : création, import, ligne écartée et reprise (identifiant du modèle seulement).
- [x] (a1) `FakeReveal` : modèles inventées pour chaque statut, un pseudo déjà pris, un nom en double (`IMPORT_MODELS`).

### Lot b (Extension)

- [x] (b1) Réglages › Ventes Reveal : bloc « N créatrices trouvées sur Reveal », une ligne par modèle (initiales, nom, pseudo, statut, action proposée modifiable), cases, « Importer la sélection » (mot de passe redemandé), résultat par ligne avec « Voir sa fiche », liste repliée « Écartées » avec « Reprendre » (`ImportPanel.tsx`, `importing.ts`). Photo : la CSP du CRM (`img-src 'self'`) refuse l'adresse Reveal ; avant l'import, ses initiales ; après, la photo copiée (lot a2).
- [ ] (b2) Badge « N nouvelles créatrices sur Reveal » pour le propriétaire seul : attend un compteur lu en base (lot a2), l'aperçu lisant Reveal en direct.
- [ ] (b2) Sur la fiche d'une créatrice importée : ce qui reste à faire (pourcentage, fuseau, persona, invitation). En b1, le résultat de l'import le dit en une ligne.
- [ ] Captures Nuit et Jour, téléphone et ordinateur, montrées à Charles avant fusion (b1 : `reglages-ventes/crm-07b/` dans les fichiers du projet).

## Critères d'acceptation

- Aucune créatrice n'est créée sans l'appel du propriétaire (test).
- L'import ne touche ni persona, ni pourcentage, ni agent, ni invitation (test).
- Rejouer l'import ne crée rien de plus (test).
- Une modèle `banned`, `refused`, `pending` ou inactive n'est pas présélectionnée (test).
- Chaque écriture d'une créatrice passe par `withTenant` de cette créatrice (intégration).

## Hors périmètre

Historique au-delà de 31 jours (export du dashboard), persona, capture de session, invitation de la créatrice.

## Notes de session

- 05/11 (Bilan, a1) : contrat et routes prêts pour le lot b. `GET /v1/settings/sales-feeds/:plateforme` rend en plus `candidates` (modèle, proposition, `preselected`) et `dismissed` ; `POST …/import` (`lines` : identifiant et action `create` ou `link`, 100 au plus, connexion récente exigée) rend un résultat par ligne (`created`, `linked`, `already_linked` ou `refused` avec sa raison) et l'aperçu ; `PUT` et `DELETE …/models/:id/dismissal` écartent et reprennent. L'import relit la liste de Reveal : il ne prend du client que les identifiants et les choix. Liste illisible : 503 `sales_feed_list_unavailable`, rien d'importé. Reste a2 (photo, statut inconnu signalé, alertes de disparition ou de bannissement).
- 05/11 (Bilan, a2a) : la lecture des ventes relit `/v1/models` un quart d'heure au plus souvent et garde ce qu'elle a vu dans `sales_feed_model_sightings` (migration 0116). Une modèle reliée absente de la liste ou passée `banned` lève une fois `model_gone` ou `model_banned` (Telegram Important, sans nom ni identifiant), à nouveau seulement après son retour. Une liste vide ne compte personne comme partie. Pour le lot b2, `GET /v1/settings/sales-feeds/new-models` (propriétaire) rend `total` et `byPlatform` : modèles de la dernière liste sans lien ni écartées, lues en base sans appeler la plateforme. Reste a2b (photo).

