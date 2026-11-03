# 0055. Dépôt de contenu : la créatrice range chaque dépôt dans sa catégorie, l'agence lui demande ce qui manque

Statut : accepted (Charles, 03/11/2026, 10 h 14, « ok 0055 », « ok 0056 », « ok 0057 » et « ok 0058 » ; phrases des relectures Bilan, Extension et Agent acceptées à 10 h 25 (« fais ce que tu me recommanderais ») ; durée de garde d'un média jamais programmé : « au bout d'un an, ça me paraît bien », 10 h 25 ; demande et décisions de Charles du 03/11/2026, 9 h 42, 9 h 53 et 9 h 58, fil « Repenser le workflow médias et scripts de la modèle » ; revue : `/mnt/project-files/espaces/medias-scripts/revue-medias-scripts-publication.md`, hors dépôt)
Date : 2026-11-03
Remplace : dans l'ADR 0044 § 1, l'usage à deux valeurs (`feed` | `mass_dm`) et la phrase « elle dépose depuis son téléphone, dans Contenu » en tant que seule description du dépôt ; dans l'ADR 0044 § 2, le point de départ des 30 jours (« jusqu'à leur publication ou leur envoi ») pour un média qui part sur plusieurs sorties.
Précise : l'ADR 0042 (§ 2 droit de regard, § 5 topo, § 8 onglet Contenu) et l'ADR 0044 (§ 3 le plan de la semaine couvre aussi les stories Reveal).

## Contexte

L'ADR 0044 fait déposer à la créatrice son contenu pour le feed ou pour les Mass DM. Le 03/11, Charles a demandé de peaufiner ce système pour qu'il coordonne **ce que l'agence demande à la créatrice et ce qu'elle envoie**, puis serve à publier automatiquement sur sa plateforme et ses réseaux.

La revue du 03/11 a relevé quatre manques : la demande n'existe pas comme objet ; deux catégories ne couvrent ni les stories, ni les scripts, ni Instagram, ni Telegram ; rien ne vérifie qu'un fichier a le bon format ; les métadonnées du téléphone (position GPS comprise) partent avec le fichier.

La revue proposait de laisser le code répartir chaque séance sur les sorties. Charles a tranché l'inverse (03/11, 9 h 53) : « c'est elle qui doit choisir […] on ne le sait pas à l'avance ce qu'elle poste, du coup c'est à elle de mettre dans le bon dossier […] ça nous évite aussi d'avoir un système qui se trompe » ; « c'est nous qui nous occupons, par contre, de poster ». Il a précisé (9 h 58) qu'une **séance boudoir** est, chez nous, une série de photos sexy pour le feed, sans rapport avec la section Boudoir de Reveal, et que story Reveal et story Instagram sont deux choses distinctes.

## Décision

### 1. Les catégories

- Chaque dépôt (`content_drop`) a **une catégorie** (`drop_category`), choisie par la créatrice. Le code ne la devine jamais et ne la change jamais. Le propriétaire (ou un manager actif) peut la corriger quand elle s'est trompée ; la correction entre au journal et la créatrice la voit.
- La liste est fermée, dans `packages/contracts` :

| Catégorie | Code | Ce qu'elle y met | Ce qu'on en fait |
|---|---|---|---|
| Feed · Séance boudoir | `feed_shoot` | quelques photos sexy et de courtes vidéos d'une même séance | une publication du feed Reveal (ADR 0044) |
| Feed · Vidéo short | `feed_video` | une vidéo verticale | une publication du feed Reveal (ADR 0044) |
| Script | `script` | un script à tourner, étape par étape | un script natif de Reveal (ADR 0056) |
| Relance | `mass_dm` | une petite photo, une petite vidéo ou un petit vocal | un Mass DM de relance (ADR 0044 § 5) |
| Story Reveal | `reveal_story` | une photo ou une vidéo verticale | une story sur Reveal |
| Story Insta | `instagram_story` | une photo ou une vidéo verticale | une story Instagram (ADR 0057) |
| Reel Insta | `instagram_reel` | une vidéo verticale | un Reel Instagram (ADR 0057) |
| Photo Insta | `instagram_post` | une ou plusieurs photos | une publication ou un carrousel Instagram (ADR 0057) |
| Telegram | `telegram_post` | une vidéo (ou une photo) | un message sur son canal d'actualité (ADR 0057) |

- La story Reveal est une capacité facultative de plus du port, comme celles de l'ADR 0044 § 6 : sa forme vient de la capture, `FakeReveal` d'abord. Elle entre dans le plan de la semaine de l'ADR 0044 § 3, avec la même acceptation.
- Une catégorie n'apparaît chez la créatrice que si sa sortie existe pour elle : compte Instagram branché, canal Telegram branché, catégorie non coupée par l'agence dans ses réglages.
- Un média ne part que vers la sortie de sa catégorie. Une story Reveal ne part jamais sur Instagram, ni l'inverse. Réutiliser un média dans une autre catégorie demande un nouveau dépôt, ou une correction de catégorie par l'agence.
- La règle « jamais de nu sur le feed » (méthode de chatting) vaut pour toutes les sorties publiques : feed, stories, Instagram, Telegram. Comme dans l'ADR 0044, aucun contrôle de ce que montre le contenu : la créatrice sait ce qu'elle dépose.

### 2. Ce que le code vérifie, sans regarder l'image

- Pour chaque catégorie, le code connaît les types admis (photo, vidéo, vocal), l'orientation, la durée et le poids maximal. Ce sont des règles de code, avec des valeurs par défaut en réglage d'agence (par exemple : vertical pour un Reel ou une story ; vocal admis seulement en Relance). Le format se lit dans les métadonnées du fichier (`ffprobe`), jamais par le modèle de vision.
- Un fichier qui ne colle pas à sa catégorie est refusé tout de suite, pendant l'envoi, avec une phrase claire en français (« Un Reel doit être vertical »). Rien n'est refusé plus tard en silence.

### 3. Le fichier reçu

- Le téléphone envoie le fichier directement au stockage (ADR 0044 § 1) : le **brut** arrive donc sous un préfixe de dépôt à part, que seul le nettoyage lit. Le serveur en **retire les métadonnées** (EXIF, position GPS, modèle de l'appareil, et les métadonnées équivalentes d'une vidéo, atomes QuickTime compris), écrit le fichier nettoyé, puis efface le brut. Une règle d'expiration du stockage efface tout brut au bout de 24 h, même si le nettoyage n'a pas eu lieu.
- Aucune lecture, aucun aperçu, aucune description par la vision ne porte sur le brut. Le fichier gardé est le fichier nettoyé ; l'empreinte `sha256` (ADR 0044 § 1) est celle du fichier nettoyé.
- Le nom d'origine du fichier n'est jamais gardé ni montré à une plateforme.
- Les conversions qu'une sortie exige (HEIC vers JPEG pour Instagram, compression pour Telegram) se font au moment de la publication, sur une copie.

### 4. La demande

- Une **demande de contenu** (`content_request`) dit ce que l'agence attend de la créatrice : une catégorie, une échéance, une raison en une phrase, et pour un script la structure demandée (ADR 0056). Elle apparaît dans son Agenda comme une **tâche** avec l'action « Déposer », la catégorie déjà choisie.
- Elle naît de trois sources : le code, quand le stock d'une catégorie passe sous son seuil (§ 5) ; la cadence des scripts (ADR 0056 § 2) ; le propriétaire ou un manager, à la main.
- Comme toute tâche (ADR 0042), personne ne la lui impose : elle peut la refuser, l'agence le voit. Rappels : une notification la veille de l'échéance et une le jour même, puis plus rien ; ces deux rappels respectent ses heures calmes.
- Un dépôt fait depuis une demande la satisfait ; un dépôt fait sans demande est libre et elle choisit sa catégorie elle-même.

### 5. Le stock

- Pour chaque catégorie publiée selon un plan (feed, stories, Instagram, Telegram, Relance), le code calcule le stock : le nombre de jours de publications prêtes au rythme réglé. Le seuil sous lequel une demande naît est un réglage d'agence par créatrice et par catégorie.
- La créatrice voit son stock en jauges, une par catégorie active, sans chiffre de vente.

### 6. Les états d'un dépôt

- Un dépôt passe par des états lisibles par la créatrice : **Reçu** (fichiers arrivés et nettoyés), **Prêt** (décrit et entré dans un plan), **Programmé**, **Publié**. Un dépôt bloqué (format, échec d'une plateforme) le dit en ambre, avec sa raison et ce qu'il faut faire.
- Elle ne voit jamais l'IA, ni qui a vendu, ni de chiffre de vente par chatteur (ADR 0042).

### 7. Conservation

- La règle de l'ADR 0044 § 2 s'applique à chaque média, mais les 30 jours partent de sa **dernière sortie prévue** : un média qui part sur une seule sortie suit la règle telle quelle ; un dépôt dont un média n'est pas encore sorti garde ses originaux.
- **Un média jamais programmé est gardé** : un média qui n'a aucune sortie prévue (jamais planifié, ou retiré du plan) garde ses originaux, pour pouvoir resservir. Ils sont effacés automatiquement **un an après son dépôt**, avec une alerte à l'agence 7 jours avant ; un média qui reçoit une sortie avant cette date repasse sous la règle du point précédent. La réutilisation des médias anciens se décidera à part (ADR 0044 § 5).

### 8. L'onglet Contenu

Dans l'ordre de ce qui compte pour elle : **À tourner** (ses demandes ouvertes, la plus proche en premier), **Déposer** (une grille de catégories, une tuile par catégorie avec une ligne d'explication), **En route** (ses dépôts récents et leur état ; un dépôt **Programmé** porte son droit de regard, ADR 0042 § 2 : voir et corriger la légende, retirer la publication, comme « Publications prévues » dans le prototype validé), **Ton stock** (les jauges), **Publié** (avec « à refaire » quand une publication a bien marché, ADR 0044 § 4, jamais rien sur ce qui n'a pas marché). La feuille de dépôt tient en trois gestes : la catégorie (déjà choisie si elle vient d'une demande), les fichiers depuis la galerie, une phrase facultative sur ce qu'elle a fait.

## Conséquences

Positives :
- La créatrice range elle-même : le code n'a rien à deviner, donc rien sur quoi se tromper.
- L'agence voit ce qui manque, ce qui est demandé, ce qui est livré et ce qui est en retard.
- Sa position et son téléphone ne sortent jamais avec ses fichiers.

Négatives, à surveiller :
- Neuf catégories, c'est beaucoup sur un téléphone : la grille ne montre que celles qui existent pour elle, et une demande arrive avec sa catégorie déjà choisie.
- Une erreur de catégorie n'est plus rattrapée par le code : elle l'est par l'agence, à la main.

## Alternatives rejetées

- **Laisser le code répartir une séance sur les sorties** (proposition de la revue du 03/11) : rejeté par Charles. On ne sait pas d'avance ce qu'elle a tourné, et un système qui devine peut se tromper.
- **Un contrôle de nudité par la vision** : toujours rejeté (ADR 0044, C3).
- **Garder les métadonnées pour dater les médias** : la date utile vient du dépôt ; la position GPS est un risque pour elle.
