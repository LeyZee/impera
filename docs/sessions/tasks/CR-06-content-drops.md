# CR-06 Dépôt de contenu : feed et Mass DM, depuis le téléphone

Statut : in_progress (lots a, b1, b2, c, vidéos lourdes de l'ADR 0070 et d faits ; reste ce qui attend les sorties, le stock et `sense` ; ADR 0044 § 1 et § 2, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0044)
Dépend de : CR-02, ADR 0030 (médiathèque), le stockage objet de production (ADR 0027, 0037)
Branche : task/cr-06-content-drops

## Objectif

La créatrice dépose une séance ou une vidéo pour le feed, ou des médias pour les Mass DM, depuis son téléphone ; chaque fichier entre dans la médiathèque et reçoit sa description.

## Contexte à lire

`docs/adr/0044-content-drops-feed-and-mass-dm.md`, ADR 0030, `docs/reference/media-vocabulary.md`, le module `media`, la configuration du stockage objet (lot 4 des factures).

## À faire

- [ ] Contrats et base (via les propriétaires) : `content_drops` (créatrice, usage `feed` | `mass_dm`, sorte `shoot` | `video`, phrase, état), ses fichiers reliés à `media_assets` par l'empreinte ; RLS par créatrice.
- [ ] Téléversement direct du téléphone vers le stockage, par une adresse signée en plusieurs parties, sans passer par le corps HTTP de Fastify, 500 Mo au plus pour une vidéo et 30 Mo pour une photo (proposition de Bilan du 02/11, réglages), types bornés, reprise d'un envoi coupé ; l'empreinte `sha256` est calculée par le serveur après l'envoi, jamais reçue du téléphone ; un fichier déjà connu (même empreinte) n'est pas repris.
- [ ] CSP (`nginx.conf.template`) : l'origine du stockage ajoutée à `connect-src`, et `media-src 'self' blob:` (plus l'origine du stockage si les aperçus en viennent) ; CORS du compartiment limité à l'origine de l'application ; sinon, les aperçus passent par l'API. Sans cela, l'envoi direct et l'aperçu d'une vidéo sont bloqués.
- [ ] Description par le rôle `sense` (ADR 0030 § 3) ; droit de regard de la créatrice sur la description, jamais obligatoire.
- [ ] Compartiment à part, **sans verrou d'objet** (celui des factures, ADR 0037, n'efface jamais) ; chaque original porte sa date d'effacement en base (publication ou envoi + 30 jours, ou retrait du dépôt) ; un job rejouable efface à cette date ; à la publication ou à l'envoi, l'original est copié sous le préfixe `released/` et l'objet d'origine effacé, et seule ce préfixe porte une règle de cycle de vie (35 jours), en filet : un dépôt en attente n'est jamais effacé par elle ; un effacement refusé passe en ambre ; trace au journal.
- [ ] Écran Contenu : déposer (choix séance ou vidéo pour le feed), voir les dépôts en attente, les retirer.

## Amendement de l'ADR 0055 (acceptée le 03/11/2026)

- [ ] L'usage `feed` | `mass_dm` devient la catégorie fermée `drop_category` de l'ADR 0055 § 1, choisie par la créatrice ; correction par l'agence au journal ; catégories affichées selon les sorties branchées et les réglages.
- [ ] Vérification du format par catégorie, par les métadonnées du fichier (`ffprobe`), refus immédiat avec une phrase claire (§ 2).
- [ ] Retrait des métadonnées (EXIF, GPS, appareil ; équivalents vidéo) à la réception, avant tout stockage durable ; empreinte du fichier nettoyé ; nom d'origine jamais gardé (§ 3).
- [ ] Demandes de contenu (`content_request`) : catégorie, échéance, raison ; tâche dans l'Agenda ; sources code (stock), cadence (SC-02), agence ; rappels la veille et le jour même (§ 4).
- [ ] Stock par catégorie et seuil réglable (§ 5) ; états Reçu, Prêt, Programmé, Publié, ambre (§ 6) ; 30 jours après la dernière sortie (§ 7).
- [ ] Onglet Contenu dans l'ordre de l'ADR 0055 § 8 : À tourner, Déposer (grille de catégories), En route, Ton stock, Publié.
- [ ] `ffprobe` dans le worker, avec délai et poids maximaux vérifiés avant l'appel ; test qui dépose un fichier inventé portant du GPS et prouve qu'il n'en reste rien après nettoyage, ni dans l'EXIF ni dans les atomes QuickTime ; le brut sous son préfixe, effacé après nettoyage, expiration 24 h (relecture Bilan).
- [ ] Écritures de la créatrice (déposer, refuser une demande) par des politiques RLS étroites : sa créatrice seulement, et pour une demande la seule transition vers « refusée » ; aucune politique générale d'écriture (CR-02 la garde en lecture seule).
- [ ] Numéros de migration attribués par Bilan au moment du lot.
- [ ] Écran (relecture Extension) : sections vides cachées ; stock lu en temps (« Prêt jusqu'à dimanche »), seules les catégories sous seuil mises en avant ; grille « Déposer » groupée par sortie (Reveal, Instagram, Telegram) ; la tuile Script ne s'ouvre que depuis une demande ; ambre seulement quand elle a quelque chose à faire ; format vérifié avant l'envoi ; un dépôt Programmé porte « corriger la légende » et « retirer ».

## Critères d'acceptation

- Tests : empreinte en double, sorte obligatoire pour le feed, effacement à J+30 seulement après publication, lecture refusée à une autre créatrice ; intégration avec MinIO comme pour les factures.
- Dépôt d'une vidéo de 500 Mo depuis un téléphone en 4G, reprise après coupure ; une vidéo plus lourde ou une photo de plus de 30 Mo refusée avec un texte clair.
- Un dépôt jamais publié reste au-delà de 35 jours ; un original publié passe sous `released/` et disparaît à sa date.
- Finition : captures Nuit et Jour, téléphone.

## Hors périmètre

Le plan de publication et l'envoi vers Reveal (CR-08, CR-11).

## Notes de session

- 03/11, lot a (migration 0108) : contrats (`content-drops.ts` : catégories, règles de format par catégorie, dépôts, fichiers déclarés, demandes, erreurs), tables `content_requests`, `content_drops`, `content_drop_files` avec FORCE RLS, politiques étroites et deux déclencheurs (elle dépose, retire un dépôt que rien n'a programmé, refuse une demande ; l'agence dépose pour elle, corrige une catégorie au journal, retire, demande, annule ; un dépôt retiré et une demande close ne reviennent jamais), module `content-drops` et ses routes. Le découpage : b envoi direct, nettoyage (ffprobe, EXIF, GPS, atomes QuickTime), empreinte, doublons, CSP, MinIO ; c effacement daté et `released/` ; d écran Contenu et captures.
- Reste après le lot a : la tâche d'Agenda d'une demande et ses deux rappels (avec le fil de l'Agenda, CR-05 b), les demandes nées du stock et de la cadence (jobs), les seuils de stock et le réglage des règles de format par l'agence (avec l'écran), la description par `sense` (clé de vision).
- 03/11, lot b1 (migration 0109) : le bucket des médias (`S3_*`, cinq réglages ensemble, le nom seul ne compte pas), l'envoi direct par morceaux de 8 Mio à des adresses signées pour leur taille exacte, la reprise d'un envoi coupé (ListParts), l'assemblage et la vérification de la taille, l'état « reçu » d'un fichier et le job `content_drops.receive_file` ; `connect-src` du CRM ouvert à l'origine du bucket (`MEDIA_ORIGIN`) ; runbook deploy.md § 4.4 (CORS, règle de 24 h sur `incoming/`). Tests contre MinIO (moto en local, sans Docker : la vérification des signatures n'y est pas faite, `IMPERA_TEST_S3_CHECKS_SIGNATURES=false`).
- Reste du lot b (b2) : le nettoyage (ffprobe, EXIF, GPS, atomes QuickTime, HEIC), le format vérifié sur le fichier arrivé, l'empreinte, le média de la médiathèque ou le doublon, le brut effacé ; un dépôt abandonné en cours d'envoi (lot c).
- 03/11, lot b2 (sans migration) : le nettoyage dans le job de réception : famille lue aux premiers octets, photos nettoyées octet par octet (JPEG, PNG, WebP, HEIC ; orientation et profil de couleur gardés), vidéos et vocaux par ffmpeg (flux copiés, aucune étiquette ni piste de données, rotation gardée), format vérifié sur le fichier nettoyé, empreinte et média de la médiathèque ou doublon, brut effacé ; le dépôt passe à prêt ou bloqué. Tests : photos construites avec un appareil et une position inventés, vidéo QuickTime et MP3 faits par ffmpeg, parcours complet contre S3.
- Reste : la description par `sense` (clé de vision ; `media.describe` n'a pas encore de tâche), l'effacement daté et le dépôt abandonné en cours d'envoi (lot c), l'écran (lot d).
- 05/11, lot c (migration 0113) : `media_assets.erased_at` ; un original gardé un an tant qu'aucune sortie n'est prévue (ADR 0055 § 7), sa date repoussée s'il est redonné ; le job horaire `content_drops.erase_originals` refuse un envoi resté inachevé 24 h, prévient l'agence 7 jours avant (`content_media_expiring`), efface les originaux dus (à leur date, ou quand tous leurs dépôts sont retirés) et les marque (`content_media_erased`) ; un effacement refusé par le bucket est dit une fois en ambre (`content_media_erase_failed`). Le préfixe `released/` et la règle des 30 jours après la dernière sortie attendent les sorties (PUB-01).
- 05/11, vidéos lourdes (ADR 0070, migration 0115) : une vidéo pèse jusqu'à 10 Gio et vient en MOV, MP4, M4V, 3GP, MKV, WebM ou AVI (flair EBML et RIFF) ; H.264 ou HEVC en ISO-BMFF recopié, en autre conteneur passé en MP4, le reste converti en MP4 H.264 (CRF 18, 4K au plus, son en AAC) par `content_drops.convert_file` dans la file `content_drops:convert`, une conversion à la fois ; délais proportionnels au poids et à la durée ; place disque prise avant le téléchargement (2,5 fois le fichier), sinon le job revient 15 minutes plus tard. Reste pour le lot d : 4 morceaux à la fois, barre par fichier, phrase au-delà de 1 Go, « En préparation ».
- Reste : la description par `sense` (clé de vision), l'écran (lot d, qui affichera l'ambre et l'annonce des 7 jours), `released/` avec PUB-01.
- 05/11, lot d (sans migration) : l'onglet Contenu de la créatrice (`/contenu`, cinquième onglet de sa barre) : À tourner (ses demandes ouvertes, la plus proche en premier, l'échéance passée en ambre, « Déposer » et « Je ne peux pas »), Déposer (tuiles groupées par sortie, Reveal seule pour l'instant, Script seulement depuis une demande), En route (état de chaque dépôt, chaque fichier : progression et temps restant, « En préparation » pendant le nettoyage ou la conversion, « Envoi interrompu » et « Reprendre » en rechoisissant le même fichier, retrait confirmé), Publié ; sections vides cachées. Feuille de dépôt : type, poids et nombre vérifiés avant l'envoi, phrase facultative, « garde l'écran allumé, en Wi-Fi si tu peux » au-delà de 1 Go. Envoi : 4 morceaux à la fois, chacun réessayé, puis le plan redemandé (reprise des morceaux stockés, adresses neuves), un fichier après l'autre, écran gardé allumé (Wake Lock) pendant l'envoi.
- Reste : Ton stock (jauges, avec les seuils), « à refaire » dans Publié et le droit de regard d'un dépôt Programmé (avec PUB-01), les tuiles Instagram et Telegram (PUB-01, PUB-02), l'annonce des 7 jours avant effacement côté agence, la description par `sense`.
- 05/11, ordre des fichiers (demande de Charles, 05/11 20 h 49 : « une suite de médias précise ») : la feuille de dépôt montre chaque fichier choisi avec sa vignette et son rang, et « monter » / « descendre » ; le même fichier choisi deux fois n'est pris qu'une fois. Le dépôt garde ce rang (`position`), et les envois partent dans cet ordre. CSP : `media-src 'self' blob:` pour la vignette d'une vidéo, lue sur le téléphone sans être envoyée. **Toute sortie (PUB-01, Mass DM) publie les fichiers d'un dépôt dans l'ordre de `position`.**
