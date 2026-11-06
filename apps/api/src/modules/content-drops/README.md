# Module `content-drops` : ses dépôts de contenu et les demandes de l'agence (CR-06, ADR 0044, ADR 0055)

Ce que la créatrice **dépose** depuis son téléphone (une catégorie qu'elle choisit, ses fichiers, une phrase facultative) et ce que l'agence lui **demande** (une catégorie, un jour, une raison, et pour un script sa structure). Le code ne devine jamais la catégorie : elle la choisit, l'agence peut la corriger.

**Peut dépendre de.** Rien. Il écrit lui-même la ligne `media_assets` d'un fichier gardé (rôle administrateur, empreinte unique par créatrice) ; la description par `sense` viendra avec la clé de vision.

**État.** Lot a : contrats (`packages/contracts`, `content-drops.ts`), tables et RLS (migration 0108), règles de format, routes. Lot b1 : l'envoi des fichiers au bucket des médias, la reprise d'un envoi coupé, la réception par un job (migration 0109). Lot b2 : le nettoyage de chaque fichier, son format vérifié, son entrée dans la médiathèque. Lot c : l'effacement daté des originaux et l'envoi abandonné (migration 0113). L'écran Contenu vient au lot d.

## Qui lit, qui écrit (migration 0108)

- **Elle** (`withCreatorAccount`, rôle `creator`) lit ses dépôts, leurs fichiers et ses demandes (sauf celles que l'agence a annulées). Elle n'écrit que trois choses : un dépôt avec ses fichiers, à son nom, à l'état « en cours d'envoi » ; le retrait d'un dépôt que rien n'a encore programmé ; le refus d'une demande ouverte, avec un motif si elle veut. Le déclencheur `guard_content_drop_change` lui refuse toute autre colonne, `guard_content_request_change` aussi.
- **Le propriétaire et un manager actif** (`withTenantMember`, portée `owner` ou `agency`) lisent tout, déposent pour elle, corrigent une catégorie (son choix reste dans `corrected_from`, et la correction entre au journal), retirent un dépôt pas encore publié, demandent et annulent. Ils ne changent jamais l'état d'un dépôt, sauf pour le retirer : ce sont les jobs qui le font avancer. Un chatteur ne lit ni n'écrit rien.
- Rien ne se supprime. Un dépôt retiré ne revient jamais, une demande close ne se rouvre jamais, pour personne, l'administrateur compris.

## Règles

- **Format** (`packages/contracts`, `DROP_FORMAT_RULES`) : chaque catégorie connaît ses sortes (photo, vidéo, vocal), si elle veut du vertical, la durée la plus longue d'une vidéo et d'un vocal, et le nombre de fichiers. Une photo fait au plus 30 Mo, une vidéo 10 Go (ADR 0070). Le type et le poids sont vérifiés à la déclaration (`declaredFileRefusal`), l'orientation et la durée sur le fichier arrivé (`probedFileRefusal`, lot b). Les mêmes phrases servent au téléphone, qui vérifie d'abord, et au serveur. Ce sont des valeurs de code ; leur réglage par l'agence viendra avec l'écran.
- **Script** : il ne se dépose que depuis une demande de script de la créatrice, ouverte (la tuile Script ne s'ouvre que depuis une demande).
- **Numéro de script** (SC-03) : donné par le serveur à « Envoyer le script », un de plus que le dernier de la créatrice, sous un verrou consultatif de transaction sur sa numérotation (jamais sa ligne `creators`, qui bloquerait toute insertion qui la nomme) ; l'index `content_drops_script_number_unique` reste la dernière garde. Ni elle ni son équipe ne l'écrivent (politiques d'insertion, aucun droit de colonne). Les noms du dossier viennent de `domain/script-naming.ts`.
- **Demande** : satisfaite par un dépôt non retiré, un seul à la fois (index `content_drops_request_live_unique`) ; retirer ce dépôt la rouvre. « Déposée » n'est donc jamais stockée.

## L'envoi des fichiers (lot b1)

- Le téléphone envoie chaque fichier **directement** au bucket des médias (`S3_*`, runbook deploy.md § 4.4), jamais par le corps d'une requête à l'API : par morceaux de 8 Mio (`DROP_PART_BYTES`), chacun à une adresse que l'API signe pour une heure et pour sa taille exacte. Le brut arrive sous `incoming/<créatrice>/<fichier>` ; le nom d'origine n'apparaît nulle part.
- `POST …/drops/:id/files/:fileId/upload` rend les morceaux qui manquent, chacun avec son adresse, et ceux que le bucket tient déjà avec leur `ETag` : un envoi coupé reprend où il s'était arrêté. Un fichier déjà entier répond `sent: true`.
- `POST …/drops/:id/files/:fileId/complete` avec chaque morceau et son `ETag` : le bucket assemble le fichier, sa taille est comparée à celle que le téléphone avait annoncée (un brut d'une autre taille est effacé, 422 `content_drop_upload_unprocessable`), puis le job `content_drops.receive_file` est mis en file dans la même transaction. Rejoué, il répond le dépôt tel qu'il est.
- Le job (rôle administrateur, seul à faire avancer un état) passe le fichier à « reçu », et le dépôt aussi quand c'était son dernier fichier en attente, avec l'événement `content_drop_received` (`dropId`, `requestId`) dans la même transaction : la veille y lit la demande née d'une idée (VEI-01 d). Un dépôt retiré pendant l'envoi a son brut effacé tout de suite.
- Sans `S3_*`, chaque envoi répond 503 `content_drop_storage_unavailable` : rien n'est gardé en mémoire à la place. Un dépôt retiré ne prend plus de fichier (409 `content_drop_file_settled_conflict`).

## Le nettoyage (lot b2)

Le même job, une fois le fichier reçu, le télécharge dans un dossier temporaire, puis :

- **lit ce qu'il est** par ses premiers octets (`domain/sniff.ts`), jamais par le type annoncé : un fichier qui n'est pas ce qu'il annonce est refusé (« Ce fichier n'est pas ce qu'il annonce : renvoie-le depuis ta galerie ») ;
- **retire ses métadonnées** (`infra/cleaning/`) :
  - une photo octet par octet, sans la décoder ni la réencoder. JPEG : EXIF, XMP, commentaires et tout ce qui suit la fin de l'image (l'iPhone y met une seconde image avec son propre EXIF) ; l'orientation est réécrite seule dans un EXIF minimal ; le profil de couleur ICC, JFIF et Adobe restent. PNG : `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`. WebP : `EXIF`, `XMP ` et leurs drapeaux. HEIC : les items EXIF et XMP recouverts de zéros sur place, aucun décalage ne bouge ;
  - une vidéo ou un vocal par ffmpeg, flux copiés sans réencodage dans un conteneur neuf : ni étiquettes globales (position ISO 6709, marque, modèle, logiciel, dates), ni celles des flux, ni chapitres, ni pistes de données (`mebx` d'Apple), ni ID3 ; la rotation, propriété du flux, reste ;
- **vérifie le format sur le fichier nettoyé** (`probedFileRefusal` : sorte, verticalité après rotation, durée) ;
- **prend l'empreinte du fichier nettoyé**, l'écrit sous `media/<créatrice>/<empreinte>` et crée le média de la médiathèque, ou marque le fichier « doublon » du média qu'elle a déjà donné ;
- **efface le brut**, refusé ou gardé.

### Les vidéos lourdes et les autres formats (ADR 0070)

- Une vidéo pèse jusqu'à 10 Gio (`DROP_MAX_BYTES`, migration 0115) et vient en MOV, MP4, M4V, 3GP (ISO-BMFF), MKV, WebM (EBML) ou AVI (RIFF), reconnus à leurs premiers octets.
- ffprobe lit son codec, et le chemin suit (`videoRouteOf`) : H.264 ou HEVC en ISO-BMFF, recopié tel quel (toute vidéo d'iPhone) ; H.264 ou HEVC dans un autre conteneur, passé en MP4 sans réencodage ; le reste (ProRes, VP8, VP9, AV1, MJPEG…), converti en MP4 H.264, profil High, CRF 18, 4K au plus. Le son est recopié s'il est en AAC, converti en AAC à 192 kbit/s sinon. Le média prend le type du fichier de sortie (`video/mp4`, ou `video/quicktime` recopié).
- Une vidéo à convertir est confiée à `content_drops.convert_file`, dans la file `content_drops:convert` : une conversion à la fois, et la réception des autres fichiers ne l'attend jamais.
- Les délais suivent le fichier : téléchargement et recopie, une seconde par 10 Mo plus une à trois minutes ; conversion, trois fois la durée plus dix minutes, quatre heures au plus. Au-delà, ffmpeg est tué et le job réessaie.
- Avant de télécharger, le job prend 2,5 fois le poids du fichier sur le disque (`infra/cleaning/room.ts`, compté avec les jobs qui tournent à côté) ; sans cette place, il revient 15 minutes plus tard, et refuse le fichier si le brut a disparu.

Le dépôt passe à « prêt » quand tous ses fichiers sont réglés et qu'au moins un est gardé, à « bloqué » (« Aucun fichier de ce dépôt n'a pu être gardé ») quand tous sont refusés. Un ffmpeg absent ou tué par son délai fait réessayer le job, jamais refuser le fichier.

## Une demande née d'une idée (VEI-01 d2)

`requestFromIdea` (index du module) écrit au rôle admin la demande d'un tournage qu'elle a accepté depuis une idée de la veille : origine `idea`, sans auteur (`content_requests_author_check`), sous l'identifiant de l'idée, rejouable (`on conflict do nothing`). Seul le job `creator_tasks.suggestion_decided` de la veille l'appelle.

## L'effacement daté (lot c)

- Un **original** est un média qu'un dépôt a gardé (un de ses fichiers le nomme à l'état `kept`). Il est gardé **un an** après le jour où il a été gardé (`media_assets.expires_at`, ADR 0055 § 7), tant qu'aucune sortie n'est prévue. Les sorties (PUB-01) ramèneront cette date à la dernière sortie plus 30 jours, avec le préfixe `released/`.
- Le job `content_drops.erase_originals` tourne chaque heure, en trois temps, chacun rejouable :
  1. un fichier qui attend encore ses octets 24 h après le début de son dépôt est refusé (« L'envoi ne s'est pas terminé dans les 24 h : dépose-le à nouveau ») et son dépôt suit, comme pour tout refus ;
  2. l'agence est prévenue 7 jours avant qu'un original parte (`content_media_expiring`, une fois par média et par date) ;
  3. chaque original dû est effacé du bucket, puis marqué (`erased_at`, `content_media_erased`). Il est dû à sa date, ou dès que **tous** les dépôts par lesquels il est venu sont retirés : un dépôt retiré efface donc ses originaux dans l'heure, sauf si un autre dépôt d'elle tient le même média.
- La ligne reste, avec l'empreinte, la durée, le type et la description (ADR 0044 § 2) ; `storage_key` ne nomme alors plus rien.
- L'effacement d'un original se fait sous le verrou de sa ligne, que la réception prend aussi : redonné pendant l'effacement, il reste (octets et ligne) ; effacé pendant une réception qui n'a pas réécrit ses octets, la réception échoue et son rejeu les réécrit. Jamais une ligne « gardée » sans ses octets.
- Un bucket qui refuse ou ne répond pas laisse l'original en place et le dit une fois en ambre (`content_media_erase_failed`) ; l'heure suivante réessaie. Aucun événement ne porte de nom ni de contenu, seulement l'identifiant du média.
- Redonné après son effacement, le même média reprend un original (le fichier nettoyé est réécrit sous sa clé) et une nouvelle date d'un an. Redonné avant, sa date est repoussée à un an à partir du nouveau dépôt.

## Le script déposé emplacement par emplacement (SC-02 lot b1, migration 0122)

Un script se dépose depuis sa demande, qui porte la version figée de sa structure (la cadence la fige ; une demande faite à la main par l'agence la fige aussi, au moment de la demander). Le dépôt commence vide dans l'état `filling` ; ses emplacements sont lus dans la version figée (`scriptSlots`, contrats) : chaque segment dans l'ordre, chaque série d'une étape à variantes en entier (`E2A`, puis `E2B`), chaque emplacement à sa place. Un emplacement se nomme `<segment>:<série>:<rang>` (`slot_key`) et garde sa position dans le script.

- Chaque fichier se déclare quand elle le choisit : son type doit être celui de l'emplacement (« Cet emplacement attend une vidéo »), son poids celui des scripts. Ses octets montent ensuite par les routes de l'envoi, comme ceux d'un dépôt ordinaire. La durée d'une vidéo (entre ses deux bornes) ou d'un vocal (au plus) se vérifie sur le fichier nettoyé : les bornes sont copiées sur la ligne du fichier.
- Remplacer un fichier garde sa position : l'ancien garde sa ligne avec `replaced_at`, sort du dépôt et de ses envois ; s'il était déjà entré dans sa médiathèque, son original s'efface comme celui d'un dépôt retiré. Le rôle applicatif ne met à jour d'un fichier que `replaced_at` et `updated_at` (droit par colonne).
- « Envoyer le script » est refusé tant qu'un emplacement obligatoire est vide, ou que son fichier a été refusé (422 `content_drop_slots_unprocessable`, les emplacements dans `details.slotKeys`). Envoyé, le dépôt passe en `uploading` sous le rôle propriétaire et suit le chemin de tout dépôt (reçu, prêt).
- Elle reprend quand elle veut, depuis n'importe quel appareil : le serveur garde chaque fichier déclaré, jamais un brouillon local. Retirer un dépôt en cours de remplissage est permis.

## Routes

- `GET /v1/creator-space/content` (créatrice) : ses demandes (la plus proche d'abord) et ses 100 derniers dépôts non retirés.
- `POST /v1/creator-space/drops` : l'identifiant du dépôt et de chaque fichier est tiré par son téléphone. Rejoué tel quel, il répond le même dépôt ; un autre contenu sous le même identifiant répond 409 `content_drop_id_conflict`. Un fichier qui ne colle pas à sa catégorie répond 422 `content_drop_format_unprocessable`, chaque phrase dans `details.refusals` ; un script sans demande 422 `content_drop_script_unprocessable` ; une demande qui n'attend plus de dépôt 422 `content_drop_request_unprocessable`.
- `DELETE /v1/creator-space/drops/:id` : retirer deux fois n'est pas une erreur ; un dépôt programmé ou publié répond 409 `content_drop_settled_conflict`.
- `POST /v1/creator-space/content-requests/:id/refuse` : le même refus rejoué ne change rien ; une demande annulée, ou déjà satisfaite, répond 409 `content_request_closed_conflict`.
- Une demande de script nomme une structure de la bibliothèque, non archivée, réservée à personne d'autre (contrôlé par le serveur et par la politique `team_insert`), sinon 422 `content_request_structure_unprocessable`.
- `POST /v1/creator-space/content/script-drops` (créatrice) : `{ id, requestId }`, son script commencé vide depuis sa demande ; rejoué, le même dépôt. Répond le dépôt, le nom et les segments de la version figée (`ScriptDrop`). Une demande sans version figée répond 422 `content_drop_script_unprocessable`.
- `GET /v1/creator-space/content/script-drops/:dropId` : la reprise.
- `PUT /v1/creator-space/content/script-drops/:dropId/slots/:slotKey` : le fichier choisi pour un emplacement (`{ id, mime, bytes }`), qui remplace le précédent ; un emplacement absent du script répond 404 `content_drop_slot_not_found`, un dépôt déjà envoyé 409 `content_drop_file_settled_conflict`.
- `POST /v1/creator-space/content/script-drops/:dropId/submit` : « Envoyer le script ».
- `GET /v1/creator-space/content/script-drops/:dropId/cards/:segmentKey[?variant=A]` (créatrice, lot b2) : un carton de son script, en SVG, dessiné depuis la version figée de son dépôt, jamais la version courante de la bibliothèque ; un segment absent répond 404 `content_drop_card_not_found`, le dépôt d'une autre créatrice 404. Servi `private, no-cache`, `nosniff`, CSP `default-src 'none'`.
- `GET /v1/creators/:creatorId/content`, `POST /v1/creators/:creatorId/drops`, `PATCH` et `DELETE /v1/creators/:creatorId/drops/:id`, `POST /v1/creators/:creatorId/content-requests`, `DELETE /v1/creators/:creatorId/content-requests/:id` (propriétaire, manager actif ; un chatteur reçoit 403 `content_drop_forbidden`). Une correction qui ne colle pas aux fichiers répond 422 ; un dépôt qui répond à une demande garde la catégorie de la demande.
