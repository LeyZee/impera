# 0136. Le feed et les stories Reveal partent seuls : une séance par publication, au moins trois par semaine, une story par jour, avec droit de retrait

Statut : accepted (Charles, 16/11/2026, 16 h 11 Paris, « OK 0136 », avec ses précisions : feed réservé aux abonnés, publications publiques laissées ouvertes ; demande du même jour, 15 h 45 et 15 h 50, fil « Publier posts et stories automatiquement » ; « une séance = un post », 16 h 02 ; avenant du 27/11/2026, § 11 : la story reprend la vidéo du feed vidéo)
Date : 2026-11-16
Amende : ADR 0044 § 3 (cadence, visibilité, acceptation humaine obligatoire), ADR 0044 § 4 (ce qu'on mesure), ADR 0055 § 5 (seuils du stock).
Précise : ADR 0044 § 6 (formes du connecteur, d'après la capture du 16/11), ADR 0083 (la légende part de la description), ADR 0126 (l'agent ne cite que ce qui est fait).
Laisse à l'ADR 0137 : le Mass DM qui accompagne une publication et le Mass DM de réveil.

## Contexte

Les ADR 0044 et 0055 ont posé le dépôt de la créatrice, le plan de la semaine, la légende écrite par l'IA, la story Reveal et la demande de contenu quand le stock baisse. Le dépôt, son nettoyage et la description des médias sont codés ; le plan, la publication et la mesure ne le sont pas : l'agence publie encore à la main (archive du dépôt puis « publié à la main »).

Le 16/11, Charles a fixé de nouvelles règles :

- **au moins trois publications par semaine sur le feed**, faites de ses séances boudoir (une collection : plusieurs photos et vidéos, une seule lingerie) ;
- **des stories tous les jours** : elles sont publiques, vues par des gens qui ne sont pas abonnés, et doivent leur donner envie de venir ;
- **une programmation pour toute la semaine** ;
- **tout ce que la créatrice donne est d'abord décrit par une IA**, et la légende s'appuie sur cette description pour être fidèle ;
- la légende du feed raconte un peu (la tenue, pourquoi elle avait envie de la partager), reste courte, dans sa voix, et finit par une question ouverte qui invite à lui écrire en privé ; la story pose toujours une question ouverte sur ce qu'on voit ;
- (16 h 11) **les trois publications du feed sont pour les abonnés** : elles servent à faire revenir ceux qui se désintéressent et ne parlent plus (« la lingerie te va bien » relance la conversation) ; **les stories, quotidiennes, visent tous les fans** ; des publications publiques viendront peut-être, rares et plus habillées, mais leur stratégie n'est pas encore pensée.

La capture du 16/11 (lue pour sa forme seulement) montre que Reveal sait créer, programmer et supprimer une publication et une story, téléverser un média, et qu'il donne des statistiques du feed public. Sur les publications passées de la créatrice : une publication est une séance entière (4 à 6 photos et 1 à 2 vidéos), le rythme a été d'environ une par semaine, et presque aucune n'était publique. Reveal a aussi un feed de découverte public, qui classe les créatrices d'après leurs publications publiques (impressions, clics, abonnés attribués, plafond de publications publiques par jour) : c'est le sujet laissé ouvert au § 5.

## Décision

### 1. Le rythme

- **Feed : au moins 3 publications par semaine**, au plus une par jour, réglage par créatrice (plancher 3, plafond 7). Les jours sont étalés (jamais deux jours de suite quand le rythme est 3, par exemple lundi, mercredi et vendredi).
- **Stories : une par jour**, deux au plus, réglage par créatrice. Deux stories du même jour sont séparées d'au moins 4 heures.
- **Heure** : celle où ses fans ont été le plus actifs les semaines passées (ADR 0044 § 3, calculée par le code), 20 h pour le feed et 12 h 30 pour la story tant qu'il n'y a pas d'historique. Jamais pendant un live (ADR 0126) : une publication prévue dans la fenêtre d'un live est décalée après sa fin.
- Quand une publication publique est prévue (§ 5), le plafond de publications publiques par jour que Reveal annonce (`maxPublicPostsPerDay`) est lu à chaque plan et n'est jamais dépassé.

### 2. Une séance, une publication

- Comme aujourd'hui et comme l'ADR 0044 le disait déjà (C12), **une séance (`feed_shoot`) est une publication entière**, toutes ses photos et vidéos, dans l'ordre du dépôt ; l'agence peut changer l'ordre. Une vidéo (`feed_video`) est une publication. Un média n'est publié qu'une fois.
- Tenir trois publications par semaine demande donc **trois dépôts de feed par semaine** : le stock (§ 7) et les demandes de contenu se règlent sur ce rythme.

### 3. La story

- Une story vient d'un dépôt Story Reveal (`reveal_story`) et de rien d'autre (ADR 0055 § 1) : une story est publique, une séance du feed est pour les abonnés, et le code ne fait jamais passer un média de l'une à l'autre.
- Stock de stories vide : aucune story ne part ce jour-là et l'alerte du § 7 se lève. Le code ne republie jamais une ancienne story.

### 4. La légende

- Le modèle de langage n'écrit que la légende (ADR 0044 § 3), à partir de la **description validée** de chaque média de la publication (ADR 0083) et de la phrase de la créatrice. Sans description validée d'un média, la publication n'est pas planifiée : elle attend, et l'écran dit pourquoi (« Descriptions pas encore ouvertes » tant que l'interrupteur de l'ADR 0083 § 9 est éteint, « Séance à valider » sinon). Une séance dont la description attend encore sa validation à moins de 48 h de son créneau lève une alerte ambre au propriétaire, pour qu'un créneau ne saute jamais en silence.
- **Feed** : une à trois phrases, dans sa voix, un peu d'histoire (la tenue, l'envie de la partager, le moment), une question ouverte qui invite à lui dire en privé ce qu'il en pense : le but est de rouvrir la conversation avec un abonné qui ne parle plus. **Story** : une phrase au plus, une question ouverte sur ce qu'on voit.
- Gardes du code sur la sortie, en plus des gardes de voix : longueur maximale par sortie, une question présente, aucun prix, aucun lien, aucune promesse de rencontre, aucun mot qui dit l'IA, jamais deux fois la même légende pour la même créatrice (comparaison normalisée). Une légende refusée est redemandée une fois, puis la publication passe en ambre.

### 5. Pour qui, et ce qui ne se vend jamais

- **Le feed est réservé aux abonnés** (`isPublic: false`) : ses trois publications par semaine servent à réengager les abonnés, pas à en recruter.
- **La story est publique** : elle vise tous les fans, abonnés ou non.
- **Une publication publique** du feed reste possible, posée à la main par le propriétaire, publication par publication ; elle n'entre jamais dans le plan automatique. Sa stratégie (rythme, tenues plus habillées, légende qui invite à s'abonner, demande à la créatrice par sa to-do) sera décidée à part, après un essai mesuré sur les abonnés attribués.
- Un média publié (feed ou story) est marqué **publié** dans la médiathèque, par son empreinte et par son identifiant Reveal. La garde ne reconnaît que ce même fichier ou ce même média du coffre : Reveal réencode, et une même photo remise à part aurait une autre empreinte (une empreinte perceptuelle demanderait sa propre ADR, ADR 0030 § 1). Le code refuse qu'un média publié entre dans un script, une étape payante, un Mass DM payant ou une offre (garde dans les modules `scripts` et `agent`), et refuse de publier un média qui a déjà été vendu ou envoyé en payant. Comme les dépôts du feed ne vont jamais au coffre des scripts (ADR 0055 § 1), cette garde ne fait que fermer la porte aux erreurs de catégorie.
- La règle « jamais de nu sur une sortie publique » (ADR 0055 § 1) reste l'affaire de la créatrice et de l'agence : aucun contrôle par la vision.

### 6. Qui valide

- Le plan de la semaine est bâti chaque **dimanche à 18 h** (heure de la créatrice) pour la semaine qui suit, puis complété chaque jour quand un dépôt arrive.
- **Mode « À valider »** (par défaut, et obligatoire pendant les deux premières semaines de chaque créatrice) : rien ne part sans l'acceptation d'un geste du propriétaire (ADR 0044 § 3, restreint ici au propriétaire et à la créatrice).
- **Mode « Automatique avec droit de retrait »** : chaque publication est programmée dans Reveal 24 h avant son heure. Jusqu'à **1 h avant**, le propriétaire ou la créatrice peut la retirer ou corriger sa légende ; le code supprime alors la publication programmée dans Reveal et la recrée (Reveal ne montre pas la modification). Le passage en automatique est un réglage par créatrice, au propriétaire seul, journalisé.
- **Le manager ne voit ni ne touche le plan du feed ni ses médias** : il ne voit du contenu des créatrices que ce qui sert le chatting (décision de Charles du 16/11 : Agenda, Scripts). Seul `<her_posts>` (§ 8) passe à l'agent.
- Une publication retirée puis recréée garde ses originaux : les 30 jours avant leur effacement (ADR 0044 § 2, ADR 0055 § 7) partent de la sortie **réelle** confirmée par Reveal, jamais d'une programmation.
- La créatrice voit tout ce qui est programmé dans « En route » (ADR 0055 § 8) et garde son droit de regard.

### 7. Le stock et la demande

- Le stock se compte en jours au rythme réglé (ADR 0055 § 5). Seuils par défaut : **moins de 7 jours de feed** ou **moins de 4 jours de stories**, une demande « Déposer » de la bonne catégorie arrive dans son Agenda (ADR 0055 § 4).
- Les seuils sont des réglages d'agence par créatrice et par catégorie (ADR 0055 § 5) ; la création des demandes « Déposer » relève de l'ADR 0140.
- Stock vide : rien ne part, aucune ancienne publication n'est republiée, et une alerte ambre arrive au Dashboard de l'agence (« Feed à sec mercredi »).

### 8. Ce que l'agent de chatting sait

- Un bloc `<her_posts>` donne à l'agent **les 3 dernières publications du feed et la story du jour**, seulement une fois que Reveal les a confirmées publiées (jamais ce qui est programmé) : la description courte, la légende et le moment relatif (« hier soir »). Comme pour `<her_day>` (ADR 0126), il ne cite que ce qui est fait.
- Un fan qui répond à une story (`storyReply`, ADR 0110) arrive avec la description de cette story.

### 9. Mesurer

- 48 h après chaque publication du feed, le code compte ses j'aime et **les abonnés silencieux depuis 7 jours qui ont réécrit dans les 48 h** : c'est la mesure de son but. Reveal ne donne ni commentaires ni vues par publication : ce qui « marche » (ADR 0044 § 4) se juge sur ces deux chiffres.
- Pour une story : ses vues. Pour une publication publique : les statistiques du feed public sur 30 jours (impressions, clics, abonnés attribués, revenu attribué).

### 10. Le connecteur et les essais

- Capacités facultatives du port (ADR 0044 § 6), d'après la capture du 16/11 : `publishPost` (médias du coffre ou téléversés, ordre, heure programmée, public), `deletePost`, `listPosts`, `publishStory`, `deleteStory`, `listStories`, `publicFeedStats`. `FakeReveal` d'abord ; formes arrêtées par le propriétaire de `packages/contracts` et du module `connectors`.
- Clé d'idempotence par publication ; avant de recréer une publication dont la réponse s'est perdue, le code relit la liste des publications programmées. Un échec ne republie jamais à l'aveugle : ambre avec sa raison.
- Pendant le développement, **rien ne part sur un vrai compte**. La première publication réelle attend le mot écrit de Charles dans le fil qui l'exécute, qui nomme l'action et le compte.

### 11. Avenant du 27/11/2026 : la story reprend la vidéo du feed vidéo

Décision de Charles (27/11/2026, 2 h 53 Paris, fil « Recette complète ») : le but est de faire gagner le plus de temps possible à la créatrice. Elle ne dépose que les médias qu'on lui demande, et Impera planifie et publie lui-même la story et le feed vidéo.

- **La story du jour est la vidéo du feed vidéo.** La même vidéo (dépôt `feed_video`) part au feed vidéo de Reveal, vu en dehors de ses fans, avec sa légende. Elle part aussi en story, vue par ses fans, avec une légende propre aux stories (§ 4 : une phrase au plus, une question ouverte sur ce qu'on voit). Cela remplace le § 3 : plus de dépôt Story Reveal (`reveal_story`) demandé à la créatrice. Le refus de faire passer un média d'une sortie à l'autre ne vaut plus entre le feed vidéo et la story ; il vaut toujours entre une séance réservée aux abonnés et une sortie publique.
- **Plus de stock ni d'alerte propres aux stories** (§ 7, seuil de 4 jours) : la story suit la vidéo. Un jour sans vidéo prévue, aucune story ne part et aucune alerte ne se lève. Le stock suivi est celui des vidéos du feed. Le retrait de l'objectif et de l'alerte de stock des stories est fait côté coffre et semaine (ADR 0140, ADR 0145) avant l'ouverture.
- **Le feed vidéo est une sortie publique du plan automatique.** Cela amende le § 5, qui gardait toute publication publique hors du plan. La séance photo reste réservée aux abonnés (`isPublic: false`). La garde « publié » du § 5 s'applique à la vidéo : une vidéo publiée au feed vidéo ou en story ne se vend jamais.
- **À vérifier avec Charles avant le lot**, sans rien supposer : les drapeaux exacts de Reveal pour chaque sortie (`videoFeedOnly`, `isPublic` de la publication et de la story, vus dans la capture du 16/11), et le rythme des vidéos qu'il veut pour tenir une story par jour.
- **Calendrier** : le lot (légende story, planification commune vidéo et story) vient après l'ouverture du 1er décembre 2026, pas avant. L'écriture vers Reveal reste éteinte par défaut, et aucune vraie publication ne part sans le mot écrit de Charles dans le fil qui l'exécute.

## Conséquences

Positives :
- Chaque publication garde la richesse d'une séance entière, comme le feed d'aujourd'hui.
- Les abonnés qui décrochent reçoivent trois occasions par semaine de reparler, et on mesure combien reviennent.
- Un média publié ne peut plus être vendu, et l'inverse, par le code.

Négatives, à surveiller :
- Trois séances par semaine, c'est beaucoup pour la créatrice : si le stock tombe souvent à sec, cette règle sera revue (découper une séance en deux, recommandation écartée le 16/11).
- Le mode automatique publie au nom de la créatrice sans regard humain : il reste au propriétaire seul et ne s'ouvre qu'après deux semaines validées.
- La stratégie du feed public reste à écrire : tant qu'elle ne l'est pas, le feed n'attire pas de nouveaux abonnés.

## Alternatives rejetées

- **Découper une séance en deux ou trois publications** (recommandation du fil) : Charles garde une séance entière par publication (16/11, 16 h 02).
- **Publier sans aucune période de validation** : le premier mois sert à régler les légendes.
- **Reprendre d'anciennes publications quand le stock est vide** : le feed se répète et les fans le voient.
