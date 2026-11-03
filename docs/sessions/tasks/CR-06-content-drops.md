# CR-06 Dépôt de contenu : feed et Mass DM, depuis le téléphone
Statut : todo (ADR 0044 § 1 et § 2, acceptée par Charles le 02/11/2026)
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

## Amendement de l'ADR 0055 (proposée le 03/11/2026 ; à appliquer dès « ok 0055 »)
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
