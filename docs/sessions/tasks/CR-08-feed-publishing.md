# CR-08 Feed et stories Reveal : la semaine préparée, validée puis publiée seule, avec droit de retrait
Statut : todo (lot a) ; lots b, c et d après le lot a (ADR 0136, acceptée par Charles le 16/11/2026 ; ADR 0044 § 3, § 4 et § 6)
Phase : espaces (ADR 0044, 0136)
Dépend de : CR-06, la capture Reveal du 16/11 (faite, formes dans l'ADR 0136 § 10), la garde d'écriture (ADR 0018), l'ADR 0145 (rôle des dossiers du coffre), l'ADR 0083 (descriptions)
Branche : task/cr-08<lot>-<slug> (une branche et une PR par lot)

## Objectif
Chaque dimanche, le code prépare la semaine : au moins trois publications du feed, une séance entière chacune et réservées aux abonnés, plus une story par jour qui reprend la vidéo du feed vidéo (ADR 0136 § 11). Le propriétaire les valide, puis elles partent seules, avec un droit de retrait jusqu'à 1 h avant.

## Contexte à lire
`docs/adr/0136-feed-and-stories-published-on-their-own.md` (tout), `docs/adr/0044-content-drops-feed-and-mass-dm.md` (§ 3, § 4, § 6), ADR 0055 (catégorie `reveal_story`), 0083 (descriptions), 0145 (rôle des dossiers), 0140 (semaine de la créatrice, demandes « Déposer »), 0126 (lives), 0018, 0003, `docs/architecture/connectors.md`, `docs/reference/fake-reveal.md`, les gardes de voix (ADR 0021).

## Lot a : le connecteur (propriétaire : `packages/contracts` et module `connectors`, fil Bilan)
- [ ] Capacités facultatives du port : `publishPost` (médias du coffre ou téléversés, ordre, heure programmée, `isPublic`), `deletePost`, `listPosts`, `publishStory` (heure programmée, publique), `deleteStory`, `listStories` (vues, expiration), `publicFeedStats`. Téléversement par URL signée (`GET /medias/get-upload-url`, puis dépôt, puis `files[]`).
- [ ] Formes ajoutées à `docs/reference/reveal-api-observed.md` (forme seule, aucune valeur réelle) ; `FakeReveal` d'abord.
- [ ] Clé d'idempotence par publication ; avant de recréer une publication dont la réponse s'est perdue, relire les publications programmées. Échec = ambre avec sa raison, jamais de republication à l'aveugle.
- [ ] Modifier une publication programmée = la supprimer puis la recréer (Reveal n'a pas montré d'édition).

## Lot b : le plan et les gardes (fil « Publier posts et stories automatiquement » ; « OK sur <sha> » du fil Médias sur ce qui touche `content-drops`)
- [ ] Plan pur, construit le dimanche à 18 h : feed ≥ 3 par semaine, au plus 1 par jour, réglable de 3 à 7, jours étalés ; une story par jour (au plus 2, 4 h d'écart). Heures par défaut 20 h (feed) et 12 h 30 (stories), dans le fuseau de la créatrice ; rien pendant un live (ADR 0126).
- [ ] Une séance = une publication. La story du jour reprend la vidéo du feed vidéo (ADR 0136 § 11), avec sa propre légende ; un jour sans vidéo, pas de story et pas d'alerte. Les drapeaux Reveal de chaque sortie et le rythme des vidéos sont à vérifier avec Charles avant ce lot, qui vient après l'ouverture du 1er décembre.
- [ ] Visibilité : séance photo `isPublic false` toujours ; feed vidéo public (ADR 0136 § 11) ; autre publication publique seulement à la main par le propriétaire.
- [ ] Marque « publié » par hash et identifiant Reveal ; garde du code : un média publié (même fichier ou même média du coffre) ne se vend jamais, et un média de vente ne se publie jamais. La story ne prend que la vidéo du feed vidéo, jamais un média d'une séance réservée aux abonnés.
- [ ] Légende : prompt versionné, écrite depuis les descriptions validées (ADR 0083), récit court et question ouverte qui invite en DM ; gardes du code sur la longueur, une question présente, aucun prix, lien ou rendez-vous, garde `ai_disclosure`, jamais répétée. Schéma Zod.
- [ ] Modes « À valider » (obligatoire les deux premières semaines) et « Automatique » (propriétaire seul, journalisé) ; retrait par le propriétaire ou la créatrice jusqu'à 1 h avant ; le manager est exclu du plan et de ses médias.
- [ ] Seuils de stock : 7 jours de feed (séances et vidéos), plus de seuil propre aux stories (ADR 0136 § 11) ; alerte quand une validation manque moins de 48 h avant le créneau ; effacement des originaux 30 jours après la publication réelle.
- [ ] Bloc `<her_posts>` pour l'agent : les 3 dernières publications et la story du jour, une fois publiées seulement (fil Agent pour l'entrée dans le prompt).
- [ ] Mesure : likes, et abonnés silencieux qui réécrivent dans les 48 h.

## Lot c : l'écran (fil Design, `apps/web`)
- [ ] La semaine en une vue : publications et stories, avec médias, légende, heure, état (à valider, programmée, publiée, retirée, en échec) ; « Tout valider » ; modifier la légende ou l'heure ; retirer.
- [ ] Messages « Descriptions pas encore ouvertes » et « Séance à valider » ; alertes de stock en ambre, échecs en rouge.
- [ ] Droit de regard et de retrait de la créatrice dans sa PWA. Captures de recette (Nuit/Jour, PC/téléphone, avis Design) avant fusion.

## Lot d : le premier essai réel
- [ ] Une publication programmée puis supprimée sur le compte, seulement sur le mot écrit de Charles dans le fil qui l'exécute, qui nomme l'action et le compte.

## Critères d'acceptation
- Tests contre `FakeReveal` : double validation sans double publication, garde d'écriture fermée = rien ne part, échec de téléversement en ambre, retrait 1 h avant respecté, réponse perdue relue avant toute recréation.
- Tests du domaine : plan à 3 par semaine sans deux le même jour, rien pendant un live, story absente quand le stock est vide, média publié refusé à la vente et l'inverse.

## Hors périmètre
La stratégie du feed public (à décider avec Charles) ; le Mass DM (CR-11) ; Instagram et Telegram (PUB-01, PUB-02).

## Notes de session
- 03/11/2026 : l'ADR 0055 (proposée) ajoute la story Reveal au plan, et l'ADR 0057 (proposée) y ajoute Instagram et Telegram ; le plan devient multi-sorties, une sortie par catégorie.
- 17/11/2026 : fiche réécrite après l'ADR 0136 (fusionnée avec #824) : capture faite, découpée en quatre lots ; « une publication par jour » et « acceptation humaine obligatoire » remplacées par l'ADR 0136.
- 27/11/2026 : avenant ADR 0136 § 11 (décision de Charles) : la story reprend la vidéo du feed vidéo, plus de dépôt ni de stock de stories ; lot b après l'ouverture du 1er décembre.
