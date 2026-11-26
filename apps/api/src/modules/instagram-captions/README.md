# Module `instagram-captions` : les légendes proposées pour ses Reels (ADR 0164 § 9)

Quand une vidéo qu'elle a déposée comme **Reel Insta** vient d'être décrite, la voix écrit trois légendes à partir de ce qu'on voit dans la vidéo, et le module les lui pose sur une carte « À décider ». Elle choisit d'un geste ; son choix est gardé par `creator-decisions` et relu par le sujet `drop:<dépôt>`.

**Peut dépendre de.** Aucun autre module : la composition (`wiring/instagram-captions.ts`) lui branche les dépôts décrits (`content-drops`), sa persona publique et ses gardes (`agent`), la voix (`LlmGateway.proposeCaptions`) et la porte `asking` de `creator-decisions`.

**État.** Lot b : la proposition, puis « D'autres idées » (`otherIdeas`, appelé par `creator-decisions`) : trois autres légendes pour le même Reel, depuis ses indications (dites au modèle dans les mots de son écran) et sa ligne, mêmes gardes, jamais une légende qu'elle lit déjà. La notification et l'écran du propriétaire viennent ensuite (fiche INS-05). Ses anciennes légendes ne sont pas encore lues : les exemples restent vides.

## Tâche `instagram_captions.propose`

- Mise en file par `described(creatorId, mediaAssetId, correlationId)` à chaque description d'un média (signal `onDescribed` de `content-drops`), sous la clé `instagram_captions.propose:<média>` : une seule en attente par média.
- Pour chaque dépôt vivant de catégorie `instagram_reel` qui tient ce média : rien si la question a déjà été posée pour ce dépôt (rejouable : une description refaite ou corrigée ne repropose rien) ; rien sans persona active ; sinon trois légendes demandées à la voix.
- **Les gardes sont dans le code** : garde de légende (`domain/caption-guard.ts` : plateforme adulte, lien, prix, « lien en bio », plus de cinq mots-clés, nudité, longueur) et gardes de sa voix sur un texte public. Une légende refusée n'est jamais montrée ; une seule réécriture est demandée, avec le nom des règles et jamais un texte. Moins de deux légendes : rien n'est posé.
- Budget IA du jour dépensé : la tâche se remet en file une heure plus tard. Tous les modèles en échec : la tâche est rejouée.
- La validation de la description par l'agence n'est pas attendue : elle relit les légendes elle-même.

## Données dans le prompt

La description du média, la phrase qu'elle a écrite avec son dépôt et ses légendes d'exemple entrent dans des blocs délimités et typés (`creator_media_description`, `creator_sentence`, `caption_examples`) : des données, jamais des consignes. Les mots de la carte (question, contexte, « C'est noté ») sont fixés dans le code.
