# Module `content-drops` : ses dépôts de contenu et les demandes de l'agence (CR-06, ADR 0044, ADR 0055)

Ce que la créatrice **dépose** depuis son téléphone (une catégorie qu'elle choisit, ses fichiers, une phrase facultative) et ce que l'agence lui **demande** (une catégorie, un jour, une raison, et pour un script sa structure). Le code ne devine jamais la catégorie : elle la choisit, l'agence peut la corriger.

**Peut dépendre de.** Rien pour l'instant. Au lot b, `media` (la médiathèque, où chaque fichier nettoyé entre par son empreinte).

**État.** Lot a : contrats (`packages/contracts`, `content-drops.ts`), tables et RLS (migration 0108), règles de format, routes. L'envoi des fichiers et leur nettoyage viennent au lot b, l'effacement daté au lot c, l'écran Contenu au lot d.

## Qui lit, qui écrit (migration 0108)

- **Elle** (`withCreatorAccount`, rôle `creator`) lit ses dépôts, leurs fichiers et ses demandes (sauf celles que l'agence a annulées). Elle n'écrit que trois choses : un dépôt avec ses fichiers, à son nom, à l'état « en cours d'envoi » ; le retrait d'un dépôt que rien n'a encore programmé ; le refus d'une demande ouverte, avec un motif si elle veut. Le déclencheur `guard_content_drop_change` lui refuse toute autre colonne, `guard_content_request_change` aussi.
- **Le propriétaire et un manager actif** (`withTenantMember`, portée `owner` ou `agency`) lisent tout, déposent pour elle, corrigent une catégorie (son choix reste dans `corrected_from`, et la correction entre au journal), retirent un dépôt pas encore publié, demandent et annulent. Ils ne changent jamais l'état d'un dépôt, sauf pour le retirer : ce sont les jobs qui le font avancer. Un chatteur ne lit ni n'écrit rien.
- Rien ne se supprime. Un dépôt retiré ne revient jamais, une demande close ne se rouvre jamais, pour personne, l'administrateur compris.

## Règles

- **Format** (`packages/contracts`, `DROP_FORMAT_RULES`) : chaque catégorie connaît ses sortes (photo, vidéo, vocal), si elle veut du vertical, la durée la plus longue d'une vidéo et d'un vocal, et le nombre de fichiers. Une photo fait au plus 30 Mo, une vidéo 500 Mo. Le type et le poids sont vérifiés à la déclaration (`declaredFileRefusal`), l'orientation et la durée sur le fichier arrivé (`probedFileRefusal`, lot b). Les mêmes phrases servent au téléphone, qui vérifie d'abord, et au serveur. Ce sont des valeurs de code ; leur réglage par l'agence viendra avec l'écran.
- **Script** : il ne se dépose que depuis une demande de script de la créatrice, ouverte (la tuile Script ne s'ouvre que depuis une demande).
- **Demande** : satisfaite par un dépôt non retiré, un seul à la fois (index `content_drops_request_live_unique`) ; retirer ce dépôt la rouvre. « Déposée » n'est donc jamais stockée.

## Routes

- `GET /v1/creator-space/content` (créatrice) : ses demandes (la plus proche d'abord) et ses 100 derniers dépôts non retirés.
- `POST /v1/creator-space/drops` : l'identifiant du dépôt et de chaque fichier est tiré par son téléphone. Rejoué tel quel, il répond le même dépôt ; un autre contenu sous le même identifiant répond 409 `content_drop_id_conflict`. Un fichier qui ne colle pas à sa catégorie répond 422 `content_drop_format_unprocessable`, chaque phrase dans `details.refusals` ; un script sans demande 422 `content_drop_script_unprocessable` ; une demande qui n'attend plus de dépôt 422 `content_drop_request_unprocessable`.
- `DELETE /v1/creator-space/drops/:id` : retirer deux fois n'est pas une erreur ; un dépôt programmé ou publié répond 409 `content_drop_settled_conflict`.
- `POST /v1/creator-space/content-requests/:id/refuse` : le même refus rejoué ne change rien ; une demande annulée, ou déjà satisfaite, répond 409 `content_request_closed_conflict`.
- Une demande de script nomme une structure de la bibliothèque, non archivée, réservée à personne d'autre (contrôlé par le serveur et par la politique `team_insert`), sinon 422 `content_request_structure_unprocessable`.
- `GET /v1/creators/:creatorId/content`, `POST /v1/creators/:creatorId/drops`, `PATCH` et `DELETE /v1/creators/:creatorId/drops/:id`, `POST /v1/creators/:creatorId/content-requests`, `DELETE /v1/creators/:creatorId/content-requests/:id` (propriétaire, manager actif ; un chatteur reçoit 403 `content_drop_forbidden`). Une correction qui ne colle pas aux fichiers répond 422 ; un dépôt qui répond à une demande garde la catégorie de la demande.
