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
- [ ] Description par le rôle `sense` (ADR 0030 § 3) ; droit de regard de la créatrice sur la description, jamais obligatoire.
- [ ] Compartiment à part, **sans verrou d'objet** (celui des factures, ADR 0037, n'efface jamais) ; chaque original porte sa date d'effacement en base (publication ou envoi + 30 jours, ou retrait du dépôt) ; un job rejouable efface à cette date ; à la publication ou à l'envoi, l'original est copié sous le préfixe `released/` et l'objet d'origine effacé, et seule ce préfixe porte une règle de cycle de vie (35 jours), en filet : un dépôt en attente n'est jamais effacé par elle ; un effacement refusé passe en ambre ; trace au journal.
- [ ] Écran Contenu : déposer (choix séance ou vidéo pour le feed), voir les dépôts en attente, les retirer.

## Critères d'acceptation
- Tests : empreinte en double, sorte obligatoire pour le feed, effacement à J+30 seulement après publication, lecture refusée à une autre créatrice ; intégration avec MinIO comme pour les factures.
- Dépôt d'une vidéo de 500 Mo depuis un téléphone en 4G, reprise après coupure ; une vidéo plus lourde ou une photo de plus de 30 Mo refusée avec un texte clair.
- Un dépôt jamais publié reste au-delà de 35 jours ; un original publié passe sous `released/` et disparaît à sa date.
- Finition : captures Nuit et Jour, téléphone.

## Hors périmètre
Le plan de publication et l'envoi vers Reveal (CR-08, CR-11).

## Notes de session
