# 0136. Le feed et les stories Reveal partent seuls : une séance par publication, au moins trois par semaine, une story par jour, avec droit de retrait

Statut : proposed (demande de Charles du 16/11/2026, 15 h 45 et 15 h 50 Paris, fil « Publier posts et stories automatiquement » ; « une séance = un post », 16 h 02)
Date : 2026-11-16
Amende : ADR 0044 § 3 (cadence, acceptation humaine obligatoire), ADR 0044 § 4 (ce qu'on mesure), ADR 0055 § 1 (la story Reveal ne prend que sa catégorie) et § 5 (seuils du stock).
Précise : ADR 0044 § 6 (formes du connecteur, d'après la capture du 16/11), ADR 0083 (la légende part de la description), ADR 0126 (l'agent ne cite que ce qui est fait).
Laisse à l'ADR 0137 : le Mass DM qui accompagne une publication et le Mass DM de réveil.

## Contexte

Les ADR 0044 et 0055 ont posé le dépôt de la créatrice, le plan de la semaine, la légende écrite par l'IA, la story Reveal et la demande de contenu quand le stock baisse. Le dépôt, son nettoyage et la description des médias sont codés ; le plan, la publication et la mesure ne le sont pas : l'agence publie encore à la main (archive du dépôt puis « publié à la main »).

Le 16/11, Charles a fixé de nouvelles règles :

- **au moins trois publications par semaine sur le feed**, faites de ses séances boudoir (une collection : plusieurs photos et vidéos, une seule lingerie) ;
- **des stories tous les jours** : elles sont publiques, vues par des gens qui ne sont pas abonnés, et doivent leur donner envie de venir ;
- **une programmation pour toute la semaine** ;
- **tout ce que la créatrice donne est d'abord décrit par une IA**, et la légende s'appuie sur cette description pour être fidèle ;
- la légende du feed raconte un peu (la tenue, pourquoi elle avait envie de la partager), reste courte, dans sa voix, et finit par une question ouverte qui invite à lui écrire en privé ; la story pose toujours une question ouverte sur ce qu'on voit.

La capture du 16/11 (lue pour sa forme seulement) montre que Reveal sait créer, programmer et supprimer une publication et une story, téléverser un média, et qu'il donne des statistiques du feed public. Sur les publications passées de la créatrice : une publication est une séance entière (4 à 6 photos et 1 à 2 vidéos), le rythme a été d'environ une par semaine, et presque aucune n'était publique. Reveal classe pourtant les créatrices dans un feed de découverte d'après leurs publications publiques (impressions, clics, abonnés attribués, plafond de publications publiques par jour).

## Décision

### 1. Le rythme

- **Feed : au moins 3 publications par semaine**, au plus une par jour, réglage par créatrice (plancher 3, plafond 7). Les jours sont étalés (jamais deux jours de suite quand le rythme est 3, par exemple lundi, mercredi et vendredi).
- **Stories : une par jour**, deux au plus, réglage par créatrice. Deux stories du même jour sont séparées d'au moins 4 heures.
- **Heure** : celle où ses fans ont été le plus actifs les semaines passées (ADR 0044 § 3, calculée par le code), 20 h pour le feed et 12 h 30 pour la story tant qu'il n'y a pas d'historique. Jamais pendant un live (ADR 0126) : une publication prévue dans la fenêtre d'un live est décalée après sa fin.
- Le plafond de publications publiques par jour que Reveal annonce (`maxPublicPostsPerDay`) est lu à chaque plan et n'est jamais dépassé.

### 2. Une séance, une publication

- Comme aujourd'hui et comme l'ADR 0044 le disait déjà (C12), **une séance (`feed_shoot`) est une publication entière**, toutes ses photos et vidéos, dans l'ordre du dépôt ; l'agence peut changer l'ordre. Une vidéo (`feed_video`) est une publication. Un média n'est publié qu'une fois.
- Tenir trois publications par semaine demande donc **trois dépôts de feed par semaine** : le stock (§ 7) et les demandes de contenu se règlent sur ce rythme.

### 3. La story

- Une story vient d'un dépôt Story Reveal (`reveal_story`). Quand le stock de stories est vide un jour donné, le code peut prendre **une photo verticale d'une séance déjà publiée** sur le feed (jamais une photo encore à publier, jamais une vidéo de plus de 60 s). Ceci amende l'ADR 0055 § 1 pour ce seul cas : le média reste public dans les deux sorties, rien n'est vendu.
- Si rien ne convient, aucune story ne part ce jour-là et l'alerte du § 7 se lève. Le code ne republie jamais une ancienne story.

### 4. La légende

- Le modèle de langage n'écrit que la légende (ADR 0044 § 3), à partir de la **description validée** de chaque média de la publication (ADR 0083) et de la phrase de la créatrice. Sans description d'un média, la publication n'est pas planifiée : elle attend, et l'écran le dit.
- **Feed** : une à trois phrases, dans sa voix, un peu d'histoire (la tenue, l'envie de la partager, le moment), une question ouverte qui invite à lui écrire en privé. **Story** : une phrase au plus, une question ouverte sur ce qu'on voit.
- Gardes du code sur la sortie, en plus des gardes de voix : longueur maximale par sortie, une question présente, aucun prix, aucun lien, aucune promesse de rencontre, aucun mot qui dit l'IA, jamais deux fois la même légende pour la même créatrice (comparaison normalisée). Une légende refusée est redemandée une fois, puis la publication passe en ambre.

### 5. Public ou abonnés, et ce qui ne se vend jamais

- **Le feed est public par défaut**, réglable par créatrice et par publication : c'est le feed public qui fait venir de nouveaux abonnés. La story est publique.
- Un média publié (feed ou story) est marqué **public** dans la médiathèque, par son empreinte et par son identifiant Reveal. Le code refuse qu'un média public entre dans un script, une étape payante, un Mass DM payant ou une offre (garde dans les modules `scripts` et `agent`), et refuse de publier un média qui a déjà été vendu ou envoyé en payant. Comme les dépôts du feed ne vont jamais au coffre des scripts (ADR 0055 § 1), cette garde ne fait que fermer la porte aux erreurs de catégorie.
- La règle « jamais de nu sur une sortie publique » (ADR 0055 § 1) reste l'affaire de la créatrice et de l'agence : aucun contrôle par la vision.

### 6. Qui valide

- Le plan de la semaine est bâti chaque **dimanche à 18 h** (heure de la créatrice) pour la semaine qui suit, puis complété chaque jour quand un dépôt arrive.
- **Mode « À valider »** (par défaut, et obligatoire pendant les deux premières semaines de chaque créatrice) : rien ne part sans l'acceptation d'un geste du propriétaire ou d'un manager actif (ADR 0044 § 3).
- **Mode « Automatique avec droit de retrait »** : chaque publication est programmée dans Reveal 24 h avant son heure. Jusqu'à **1 h avant**, le propriétaire, un manager actif ou la créatrice peut la retirer ou corriger sa légende ; le code supprime alors la publication programmée dans Reveal et la recrée (Reveal ne montre pas la modification). Le passage en automatique est un réglage par créatrice, au propriétaire seul, journalisé.
- La créatrice voit tout ce qui est programmé dans « En route » (ADR 0055 § 8) et garde son droit de regard.

### 7. Le stock et la demande

- Le stock se compte en jours au rythme réglé (ADR 0055 § 5). Seuils par défaut : **moins de 7 jours de feed** ou **moins de 4 jours de stories**, une demande « Déposer » de la bonne catégorie arrive dans son Agenda (ADR 0055 § 4).
- Stock vide : rien ne part, aucune ancienne publication n'est republiée, et une alerte ambre arrive au Dashboard de l'agence (« Feed à sec mercredi »).

### 8. Ce que l'agent de chatting sait

- Un bloc `<her_posts>` donne à l'agent **les 3 dernières publications du feed et la story du jour**, seulement une fois que Reveal les a confirmées publiées (jamais ce qui est programmé) : la description courte, la légende et le moment relatif (« hier soir »). Comme pour `<her_day>` (ADR 0126), il ne cite que ce qui est fait.
- Un fan qui répond à une story (`storyReply`, ADR 0110) arrive avec la description de cette story.

### 9. Mesurer

- 48 h après chaque publication, le code lit les j'aime de la publication, les vues de la story, et les statistiques du feed public sur 30 jours (impressions, clics, abonnés attribués, revenu attribué). Reveal ne donne ni commentaires ni vues par publication du feed : ce qui « marche » (ADR 0044 § 4) se juge sur les j'aime et, pour le compte, sur les abonnés attribués.

### 10. Le connecteur et les essais

- Capacités facultatives du port (ADR 0044 § 6), d'après la capture du 16/11 : `publishPost` (médias du coffre ou téléversés, ordre, heure programmée, public), `deletePost`, `listPosts`, `publishStory`, `deleteStory`, `listStories`, `publicFeedStats`. `FakeReveal` d'abord ; formes arrêtées par le propriétaire de `packages/contracts` et du module `connectors`.
- Clé d'idempotence par publication ; avant de recréer une publication dont la réponse s'est perdue, le code relit la liste des publications programmées. Un échec ne republie jamais à l'aveugle : ambre avec sa raison.
- Pendant le développement, **rien ne part sur un vrai compte**. La première publication réelle attend le mot écrit de Charles dans le fil qui l'exécute, qui nomme l'action et le compte.

## Conséquences

Positives :
- Chaque publication garde la richesse d'une séance entière, comme le feed d'aujourd'hui.
- Le feed public, levier d'acquisition de Reveal, est enfin nourri.
- Un média public ne peut plus être vendu, et l'inverse, par le code.

Négatives, à surveiller :
- Trois séances par semaine, c'est beaucoup pour la créatrice : si le stock tombe souvent à sec, cette règle sera revue (découper une séance en deux, recommandation écartée le 16/11).
- Le mode automatique publie au nom de la créatrice sans regard humain : il reste au propriétaire seul et ne s'ouvre qu'après deux semaines validées.
- La story prise dans une séance publiée montre deux fois la même photo à un abonné attentif.

## Alternatives rejetées

- **Découper une séance en deux ou trois publications** (recommandation du fil) : Charles garde une séance entière par publication (16/11, 16 h 02).
- **Publier sans aucune période de validation** : le premier mois sert à régler les légendes.
- **Reprendre d'anciennes publications quand le stock est vide** : le feed se répète et les fans le voient.
