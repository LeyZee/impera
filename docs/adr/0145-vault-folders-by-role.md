# 0145. Les dossiers du coffre ont un rôle : un dossier par script, des dossiers Mass DM et feed, le code lit le rôle et jamais le nom

Statut : accepted (Charles, 16/11/2026, 17 h 36, « ok 0145 » ; demande de Charles, 16/11/2026, 17 h 28 : « tu crées un nouveau dossier et tu mets les médias dans ce nouveau dossier […] comme ça, ça se mélange pas avec le reste », « il faudrait créer un dossier Mass DM et un dossier post-feed »)
Date : 2026-11-16
Amende : l'ADR 0099 § 2 (« le CRM ne crée aucun dossier du coffre »), pour les seuls dossiers de cette ADR.
Précise : l'ADR 0056 (§ 5 la nomenclature, § 7 vers Reveal dans l'ordre), l'ADR 0113 § 5 (ce qui est décrit), l'ADR 0018 (garde d'écriture), l'ADR 0136 (feed) et l'ADR 0137 (Mass DM).

## Contexte

Aujourd'hui, le coffre Reveal d'une créatrice mélange tout : des dossiers de scripts, des médias posés à la racine, ce qui a servi à un Mass DM. Le CRM le lit tel quel (ADR 0099), et l'IA ne sait pas d'où vient un média, sauf à deviner d'après le nom de son dossier.

Charles demande trois choses :
- quand la créatrice dépose un nouveau script par le CRM, que ses médias aillent dans un dossier neuf, bien nommé, pour qu'ils ne se mélangent pas au reste ;
- un dossier pour les Mass DM et un dossier pour les posts du feed, « pour qu'on mélange rien et que l'IA s'y repère » ;
- pouvoir choisir ce qui est décrit : les dossiers par défaut, tous les médias s'il le décide.

Le dossier par script est déjà décidé par l'ADR 0056 (§ 5 et § 7), mais il attend la capture des écritures du coffre (fiche SC-06). Chez Reveal, un média ne vit que dans un seul dossier. Les appels de création de dossier et de téléversement ont été vus pendant la capture (`docs/reference/reveal-api-observed.md`, « Non utilisés »), mais leur forme n'a jamais été relevée.

Reveal a déjà des dossiers système verrouillés, dont « Feed » et « Mass DM » (`docs/reference/reveal-connector-inventory.md`, Vault). D'après la capture du 16/11 (fil Publication, forme seulement), un post, une story ou un Mass DM prend soit des médias du coffre, soit des fichiers téléversés à part. Les ADR 0136 et 0137 prévoient de téléverser depuis nos dépôts. Reveal range probablement seul ces fichiers dans ses dossiers système, mais il faut le vérifier.

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
- **Mass DM** et **feed** : le CRM ne crée rien. Ce sont les dossiers système de Reveal, « Mass DM » et « Feed », un seul pour chaque rôle. Ils reçoivent leur rôle une fois pour toutes : par le marqueur système que Reveal renvoie s'il existe, sinon de la main de Charles (§ 4). Condition (Charles, 16/11, 17 h 35) : la capture doit montrer qu'on peut y ajouter des médias directement, ou que Reveal y range seul ce qu'on téléverse pour un post ou un Mass DM. Sinon, la question revient à Charles avant tout code. La solution de repli serait un dossier « MASS DM » et un dossier « FEED » à nous, un seul de chaque. Le code suit chaque média par son identifiant et son état (publié, envoyé) : un dossier par mois n'apporterait rien au tri, et ferait plus de dossiers à déclarer. Les médias de relance demandés chaque semaine (ADR 0140) sont des médias de Mass DM.
- Le nom est calculé par le serveur, jamais par le modèle de langage. Un dossier créé reçoit son rôle au moment où il est créé.
- Toutes ces écritures passent par la garde d'écriture (ADR 0018 § 3) et une clé d'idempotence. Une reprise repart de la position atteinte. Rien n'est jamais renommé, déplacé ni supprimé dans Reveal.

### 4. Les dossiers existants

À la synchronisation, un dossier inconnu arrive `unclassified`. Charles lui donne son rôle une fois, dans l'écran du coffre. Le CRM peut lui proposer un rôle d'après le nom (« SCRIPT … » → `script`), mais ce n'est qu'une proposition : il la confirme. Un dossier sans rôle confirmé reste `unclassified`.

### 5. Ce qui est décrit

Par défaut, la description par la vision (ADR 0113 § 5, amendée le 16/11) ne prend que les médias des dossiers, jamais ceux de la racine (Charles, 16/11, 17 h 28 : « prends seulement ce qu'il y a dans les dossiers »). Sur chaque dossier, un interrupteur « Décrire » permet de l'en retirer. Une option « Tous les médias » ajoute ceux de la racine, s'il le décide. Avant de lancer, l'écran annonce le nombre de médias et le coût estimé.

### 6. Avant tout code d'écriture

Il faut d'abord une capture ciblée sur le PC de Charles : la création d'un dossier, le téléversement dans un dossier, ce que Reveal fait d'un fichier téléversé pour un post ou un Mass DM, et la façon dont la liste des dossiers marque un dossier système. Il faut leurs formes, leurs réponses et leurs erreurs. Aucun `.har` ne quitte le PC. `FakeReveal` est écrit d'abord. Rien n'est créé sur un vrai compte sans le mot de Charles écrit dans le fil qui exécute.

## Conséquences

- Une table ou une colonne garde le rôle des dossiers du coffre (`vault_folder_role`, terme ajouté au glossaire). La migration est additive : tout dossier existant arrive `unclassified`.
- L'écran du coffre montre le rôle de chaque dossier et permet de le changer. Le propriétaire est seul à décider ; le manager voit.
- L'agent et le copilote lisent le rôle avec le média. La garde du § 2 s'ajoute à celles de l'envoi.
- Sans la capture, ou si Reveal ne permet pas ces écritures, l'ADR 0056 § 7 s'applique : export ZIP et fiche à recopier, avec le nom de dossier à créer à la main.

## Alternatives rejetées

- **Déduire le rôle du nom du dossier.** Un nom se change à la main dans Reveal, et une faute de frappe suffirait pour vendre un média déjà offert.
- **Un dossier Mass DM et un dossier feed par mois.** Plus lisible à l'œil dans Reveal, mais le code n'en a pas besoin, et chaque mois ajouterait un dossier à déclarer. Pour s'y retrouver à l'œil, le mois peut aller dans le nom du fichier.
- **Créer nos propres dossiers Mass DM et feed d'emblée.** Reveal en a déjà, verrouillés ; en créer d'autres doublerait les endroits où chercher.
- **Ranger les médias existants dans les nouveaux dossiers.** Ce serait déplacer dans Reveal, ce que cette ADR exclut.

## Réponses de Charles (16/11/2026, 17 h 35)

1. Le nom d'un dossier de script : « fais ce que tu me recommandes », avec la tenue que porte la modèle en plus du thème (§ 3).
2. Les dossiers système « Mass DM » et « Feed » de Reveal : « si on peut directement ajouter des médias dans ces dossiers-là, alors go, on n'a pas besoin de créer les nôtres » (17 h 35, § 3). À vérifier à la capture.
