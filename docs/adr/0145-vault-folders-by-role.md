# 0145. Les dossiers du coffre ont un rôle : un dossier par script, une réserve Mass DM et une réserve Feed, le code lit le rôle et jamais le nom

Statut : accepted (Charles, 16/11/2026, 17 h 36, « ok 0145 » ; avenant du § 5 accepté le 17/11/2026, 14 h 17, « oki parfait » ; second avenant du § 5 le 20/11/2026, l'écran ne montre que ce qui est dans Impera, accepté avec le lot de captures `coffre-choisir-1` ; amendée par Charles le même jour à 17 h 41 après la capture : réserves Mass DM et Feed à nous ; demande de Charles, 16/11/2026, 17 h 28 : « tu crées un nouveau dossier et tu mets les médias dans ce nouveau dossier […] comme ça, ça se mélange pas avec le reste », « il faudrait créer un dossier Mass DM et un dossier post-feed »)
Date : 2026-11-16
Amende : l'ADR 0099 § 2 (« le CRM ne crée aucun dossier du coffre »), pour les seuls dossiers de cette ADR. Avenant du 17/11 : amende aussi l'ADR 0113 § 5 (la description du coffre ne part plus seule, par lots, mais sur une sélection confirmée) et l'ADR 0083 § 9 (plus d'interrupteur des descriptions : un dépôt est décrit à son arrivée).
Précise : l'ADR 0056 (§ 5 la nomenclature, § 7 vers Reveal dans l'ordre), l'ADR 0113 § 5 (ce qui est décrit), l'ADR 0018 (garde d'écriture), l'ADR 0136 (feed) et l'ADR 0137 (Mass DM).

## Contexte

Aujourd'hui, le coffre Reveal d'une créatrice mélange tout : des dossiers de scripts, des médias posés à la racine, ce qui a servi à un Mass DM. Le CRM le lit tel quel (ADR 0099), et l'IA ne sait pas d'où vient un média, sauf à deviner d'après le nom de son dossier.

Charles demande trois choses :
- quand la créatrice dépose un nouveau script par le CRM, que ses médias aillent dans un dossier neuf, bien nommé, pour qu'ils ne se mélangent pas au reste ;
- un dossier pour les Mass DM et un dossier pour les posts du feed, « pour qu'on mélange rien et que l'IA s'y repère » ;
- pouvoir choisir ce qui est décrit : les dossiers par défaut, tous les médias s'il le décide.

Le dossier par script est déjà décidé par l'ADR 0056 (§ 5 et § 7), mais il attend la capture des écritures du coffre (fiche SC-06). Chez Reveal, un média ne vit que dans un seul dossier. Les appels de création de dossier et de téléversement ont été vus pendant la capture (`docs/reference/reveal-api-observed.md`, « Non utilisés »), mais leur forme n'a jamais été relevée.

Reveal montre dans le coffre « Feed », « Mass DM », « Message » et « Tous les médias ». La capture du 16/11 a montré que ce ne sont pas des dossiers mais des **catégories** : elles se lisent par un filtre de la liste des médias, n'apparaissent pas dans la liste des dossiers, et se remplissent seules quand on publie ou qu'on envoie. L'écran de Reveal n'y laisse rien ajouter. Un vrai dossier n'a ni type ni marqueur système, seulement un nom.

## Décision

### 1. Un rôle par dossier, déclaré dans le CRM

Chaque dossier du coffre porte un rôle, gardé par le CRM :
- `script` : les médias d'un script, vendus étape par étape ;
- `mass_dm` : les médias offerts dans les Mass DM (ADR 0137) ;
- `feed` : les médias des posts du feed (ADR 0136) ;
- `unclassified` : tout le reste, jusqu'à ce qu'un humain le classe.

Le code lit le rôle, **jamais le nom** du dossier. Le nom sert aux humains qui ouvrent le coffre dans Reveal. Renommer un dossier dans Reveal ne change pas son rôle.

### 2. Une garde dans le code, pas dans un prompt

- **Jamais revendu.** Un média d'un dossier `mass_dm` ou `feed` n'entre jamais dans une étape payante, et l'agent ne le présente jamais comme exclusif.
- **La marque du média l'emporte sur le dossier.** Chez Reveal, un humain peut déplacer un média d'un dossier à l'autre. La garde lit donc aussi la marque que porte chaque média publié ou envoyé gratuitement (ADR 0136 § 5 : son empreinte et son identifiant Reveal). Elle refuse dès que l'un des deux dit non : un média publié ou offert n'entre jamais dans une étape payante, quel que soit son dossier.
- **Ce qu'un Mass DM automatique peut prendre** (ADR 0137 § 3) : un média `mass_dm`, pour le réveil et le merci de fidélité ; ou, pour l'annonce d'un post, une photo de la publication annoncée (`feed`, déjà vue des abonnés). C'est le seul cas où un média `feed` part en Mass DM. Jamais un média `script` ni `unclassified`.
- **Story** : un média `feed` (réservé aux abonnés) ne passe jamais en story (publique), comme le dit l'ADR 0136 § 3.
- Un média `unclassified` n'entre dans un script que par un humain, comme aujourd'hui.

La garde vit dans le domaine. Elle est testée en unitaire et contre `FakeReveal`, déplacement d'un média compris.

### 3. Les dossiers que le CRM crée

- **Script** : à l'acceptation d'un script déposé par la créatrice (ADR 0056 § 7), le connecteur crée son dossier, puis téléverse les fichiers un à un, dans l'ordre des noms. Le dossier est nommé `S<nnn> · <thème> · <tenue> · ☀️` ou `🌙` (exemple inventé : « S014 · salon · nuisette noire · 🌙 »). Le numéro garde l'ordre, et l'emoji reste la convention que le code lit déjà pour le moment d'un script natif (glossaire, « Moment d'un script natif »). La tenue est un champ court du dépôt, que la créatrice remplit ; la description par la vision peut le pré-remplir, mais c'est elle qui le confirme. Sans tenue, le nom s'en passe. Le thème et la tenue sont coupés pour que le nom reste court, et un nom ne change plus une fois le dossier créé.
- **Mass DM** et **feed** : deux dossiers à nous, créés par le CRM, un seul de chaque : « RÉSERVE · Mass DM » et « RÉSERVE · Feed ». C'est là que vont les médias prévus pour un Mass DM ou pour un post, et le CRM les gère (amendement de Charles, 17 h 41, après la capture). Les catégories « Mass DM » et « Feed » de Reveal restent la **trace** de ce qui est parti : la synchronisation peut les lire pour marquer un média comme envoyé ou publié, ce qui nourrit la marque du § 2. Le mot « RÉSERVE » les distingue de ces catégories à l'œil. Le code suit chaque média par son identifiant et son état (publié, envoyé) : un dossier par mois n'apporterait rien au tri. Les médias de relance demandés chaque semaine (ADR 0140) vont dans « RÉSERVE · Mass DM ».
- Le nom est calculé par le serveur, jamais par le modèle de langage. Un dossier créé reçoit son rôle au moment où il est créé.
- Toutes ces écritures passent par la garde d'écriture (ADR 0018 § 3) et une clé d'idempotence. Une reprise repart de la position atteinte. Rien n'est jamais renommé, déplacé ni supprimé dans Reveal.

### 4. Les dossiers existants

À la synchronisation, un dossier inconnu arrive `unclassified`. Charles lui donne son rôle une fois, dans l'écran du coffre. Le CRM peut lui proposer un rôle d'après le nom (« SCRIPT … » → `script`), mais ce n'est qu'une proposition : il la confirme. Un dossier sans rôle confirmé reste `unclassified`.

### 5. Ce qui entre dans le CRM, et ce qui est décrit

*Avenant du 17/11/2026, accepté par Charles (« oki parfait », 14 h 17 ; demande de Charles, 17/11, 14 h 13 heure de Paris, après avoir ouvert l'écran du coffre : « il ne faut pas que ça importe tout », « je dois pouvoir sélectionner soit les fichiers séparés, soit les dossiers entiers », « des petites coches », « le bouton faire la description par IA avec le coût »). Il remplace la règle précédente de ce paragraphe (les dossiers décrits par défaut, un interrupteur « Décrire » par dossier, une option « Tous les médias »).*

- **La synchronisation lit tout, le CRM ne garde que ce qui est choisi.** La synchronisation reste la lecture gratuite de la liste du coffre, sans fichier (ADR 0099). Chaque dossier porte une coche « Importer », et chaque média la sienne. Un média est importé si son dossier est coché et que lui-même n'est pas décoché, ou s'il est coché à part.
- **Rien n'est importé sans un geste.** La racine du coffre et tout dossier qui apparaît dans Reveal arrivent non cochés. Seul un dossier de script créé par le CRM (§ 3) arrive coché, puisqu'il naît d'un dépôt accepté.
- **Un média non importé reste visible dans l'écran du coffre**, en retrait, pour qu'on puisse le cocher. L'agent, le copilote, les scripts et les Mass DM ne le voient pas : il n'existe pas pour eux.
- **La description par la vision ne part qu'à la demande** (ADR 0113 § 5, ADR 0083). Dans un dossier ouvert, on coche un, plusieurs ou tous les médias importés. Une barre annonce le nombre et le coût estimé (« Décrire 12 médias · ≈ 0,06 € »). Rien ne part avant la confirmation. Un média déjà décrit n'est pas compté deux fois. Aucun job ne décrit plus le coffre de lui-même, et aucun interrupteur global ne fait décrire en continu (Charles, 17/11, 14 h 20 : « c'est moi qui dois choisir qu'est-ce que je veux décrire pour maîtriser les coûts ») : la passe horaire est retirée, et l'interrupteur « Descriptions par l'IA » de la fiche disparaît. Un dépôt de la créatrice par le CRM reste décrit d'office : le dépôt vaut choix (Charles, 17/11, 14 h 21, sur la question posée). Le plafond de dépense de l'IA (ADR 0091) s'applique comme ailleurs.
- **Qui choisit.** Le propriétaire coche et lance. Un manager actif voit ce qui est importé et décrit, sans cocher ni lancer.
- Les coches de l'écran sont des contrôles du design system, jamais des cases natives.

*Avenant du 20/11/2026, sur la demande de Charles après avoir ouvert l'écran sur son PC (fil Bilan, 20/11, 16 h 29 et 16 h 33 UTC : « ça doit m'ouvrir ce qu'il y a dans Reveal […] et d'une fois que je clique synchroniser, ça m'importe uniquement les dossiers […] que j'ai sélectionnés » ; « les dossiers sont déjà tous importés de base […] il faut refaire le système »). En base, rien n'était importé : l'écran montrait toute la liste lue chez Reveal comme si elle l'était. Proposé avec le lot de captures `coffre-choisir-1` ; accepté avec son « ok captures ». Il remplace le troisième point ci-dessus et précise les autres :*

- **L'écran du coffre ne montre que ce qui est dans Impera** : les dossiers dont au moins un média est importé (ou cochés entiers), et dans un dossier ses seuls médias importés. Ce qu'un dossier garde dans Reveal est dit en une ligne, avec un chemin pour le choisir.
- **Un seul bouton, « Choisir dans Reveal »** (en tête du coffre, et dans l'état vide) : il relance la synchronisation (lecture gratuite, inchangée) et ouvre une fenêtre qui montre ce qu'elle lit, ses dossiers en cartes, la racine en dernier sous le nom « Médias hors dossier ». Une carte coche son dossier entier ; « Voir les médias » l'ouvre pour cocher média par média. Rien n'est écrit avant « Importer », qui dit ce qui entre et ce qui sort. Un média non importé n'est visible que dans cette fenêtre.
- **« Retirer d'Impera »** se fait depuis un dossier importé, sur une sélection, après une fenêtre qui dit ce qui reste : rien ne bouge dans Reveal, les descriptions sont gardées pour un import ultérieur.
- **Le flou suit partout le réglage du menu** (« Flou des médias »), dans la fenêtre comme en mode Sélectionner.
- Les règles des coches, de la description à la demande et de qui choisit ne changent pas. Le serveur ne change pas.

### 6. Ce que la capture a montré, et l'idempotence

La capture ciblée a été faite le 16/11 sur le PC de Charles et lue sur place par le fil Bilan, formes seulement. Créer un dossier, c'est un appel qui prend un nom. Téléverser se fait en trois temps (une URL signée, l'envoi des octets vers un hôte de stockage déjà écrit dans le code par l'ADR 0113 § 2, puis la création du média rattaché à son dossier). Aucun appel pour déplacer un média existant n'a été vu. Reveal n'offre ni en-tête d'idempotence ni contrôle de doublon connu : l'idempotence est la nôtre. Avant de créer un dossier, le connecteur relit la liste et reprend un dossier du même nom. Avant de créer un média, il cherche dans le dossier le fichier de même empreinte, et chaque envoi porte sa clé dans notre journal. Ces formes entrent dans `docs/reference/reveal-api-observed.md`, puis dans `FakeReveal` avant tout code. Le renommage, l'archivage et la suppression vus dans la capture sont notés « jamais appelés ». Rien n'est créé sur un vrai compte sans le mot de Charles écrit dans le fil qui exécute.

## Conséquences

- Une table ou une colonne garde le rôle des dossiers du coffre (`vault_folder_role`, terme ajouté au glossaire). La migration est additive : tout dossier existant arrive `unclassified`.
- L'écran du coffre montre le rôle de chaque dossier et permet de le changer. Le propriétaire est seul à décider ; le manager voit.
- Une table garde la sélection d'import du coffre (dossier entier ou média seul), additive, sous RLS forcée ; tout ce qui existe arrive non importé, et le job qui décrivait seul les médias en attente cesse de partir. La lecture des médias par l'agent et le copilote filtre sur la sélection.
- L'agent et le copilote lisent le rôle avec le média. La garde du § 2 s'ajoute à celles de l'envoi.
- Sans la capture, ou si Reveal ne permet pas ces écritures, l'ADR 0056 § 7 s'applique : export ZIP et fiche à recopier, avec le nom de dossier à créer à la main.

## Alternatives rejetées

- **Déduire le rôle du nom du dossier.** Un nom se change à la main dans Reveal, et une faute de frappe suffirait pour vendre un média déjà offert.
- **Un dossier Mass DM et un dossier feed par mois.** Plus lisible à l'œil dans Reveal, mais le code n'en a pas besoin, et chaque mois ajouterait un dossier à déclarer. Pour s'y retrouver à l'œil, le mois peut aller dans le nom du fichier.
- **Se servir des dossiers système « Mass DM » et « Feed » de Reveal comme réserve.** C'était le premier choix (Charles, 17 h 35), mais Reveal ne permet pas d'y ajouter un média (capture du 16/11).
- **Ranger les médias existants dans les nouveaux dossiers.** Ce serait déplacer dans Reveal, ce que cette ADR exclut.

## Réponses de Charles (16/11/2026, 17 h 35)

1. Le nom d'un dossier de script : « fais ce que tu me recommandes », avec la tenue que porte la modèle en plus du thème (§ 3).
2. Les dossiers système « Mass DM » et « Feed » de Reveal : « si on peut directement ajouter des médias dans ces dossiers-là, alors go » (17 h 35). La capture a montré que non. Amendement de Charles (17 h 41) : « il va bien falloir qu'on les crée nous, comme ça on peut les ajouter nous et les gérer nous » (§ 3).
