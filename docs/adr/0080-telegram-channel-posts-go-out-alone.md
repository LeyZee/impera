# 0080. Canal Telegram de la créatrice : les posts partent seuls à leurs créneaux, montrés une heure avant, avec un lien de redirection réglé dans le CRM

Statut : accepted (Charles, 07/11/2026 12h26, « ok 0080 », avec ses réponses aux questions du brouillon ; demande du même jour à 12h14 ; fil « Automatiser le canal Telegram de Messa »). Les phrases écrites d'après ses réponses, marquées †, acceptées le 07/11/2026 à 13h05 (« ok phrases 0080 »).
Date : 2026-11-07
Précise : l'ADR 0057 (connecteur Telegram, légendes, lien ajouté par le code), l'ADR 0055 § 1 et § 5 (catégorie `telegram_post`, stock et demandes), l'ADR 0020 (groupes de l'agence).
Remplace : pour le canal Telegram seulement, dans l'ADR 0057 § 3, « acceptation d'un geste par le propriétaire ou un manager » (§ 2 ci-dessous) ; dans l'ADR 0057 § 6, « le code ajoute l'adresse enregistrée dans Réglages » devient le lien de redirection du § 4 ; dans l'ADR 0055 § 1, « Un média ne part que vers la sortie de sa catégorie » pour la vidéo publique Reveal (§ 3 ci-dessous).

## Contexte

L'ADR 0057 a ouvert le canal Telegram d'actualité de la créatrice : le bot de l'agence (celui des alertes) en est administrateur, la légende est écrite dans sa voix pour donner envie de venir sur Reveal, le lien n'est jamais écrit par le modèle de langage. Le but du canal, dit Charles le 07/11 : **une présence continue sur Telegram, qui ramène du monde sur Reveal**, avec des appels à venir réguliers qui paraissent naturels, jamais vendeurs, et des messages agréables à lire.

Charles demande en plus :

1. des posts qui **partent seuls**, chaque jour à des heures réglées (19 h pour commencer, peut-être deux par jour ensuite), montrés une heure avant pour qu'il puisse les arrêter, les faire réécrire ou donner un conseil pour la réécriture ;
2. un pool qui **se remplit seul** : dès qu'il manque des médias, une demande de dépôt part à la créatrice ;
3. la **vidéo publique Reveal** reprise sur le canal : Reveal permet un post public en format vidéo, qui n'apparaît pas dans le feed de la créatrice et n'est montré qu'aux abonnés d'autres modèles ; ses abonnés à elle ne le voient jamais. La même vidéo sert donc deux fois sans que la créatrice tourne deux contenus. La forme exacte viendra des captures de Charles ;
4. un **lien de redirection** (un service de redirection qui ouvre le navigateur par défaut, distinct du lien de suivi Reveal), qu'il veut pouvoir changer facilement ;
5. un **écran** pour tout régler, et un **playground** où l'on bascule entre le chatting et ces posts.

## Décision

### 1. Les créneaux

1. Chaque créatrice dont le canal est branché a une liste de **créneaux de publication** (`channel_slot`) : une heure dans son fuseau (`creators.timezone`), les jours de la semaine, allumé ou éteint. Le nombre de posts par jour est le nombre de créneaux allumés ce jour-là ; au plus 4. †
2. Le premier créneau proposé est **19 h, tous les jours**. Tout se change à l'écran.
3. Deux créneaux d'un même jour sont à 3 h d'écart au moins (le code refuse l'enregistrement sinon). †
4. Une seule publication par créneau et par jour : clé d'idempotence `telegram_channel:<créneau>:<jour>`. Le job est rejouable ; une réponse perdue de Telegram passe en ambre (aucun renvoi), seul un refus explicite est repris (relecture Bilan de PUB-01).

### 2. Ça part seul, montré une heure avant

1. Un post **part seul** à l'heure de son créneau. Il n'attend aucune acceptation.
2. À l'heure moins la **fenêtre d'aperçu** (1 h par défaut, réglable de 15 min à 4 h), le code prépare le post (média, légende, lien) et le groupe Telegram « Info » de l'agence reçoit « Post du canal de \<créatrice\> à 19:00 », avec un lien vers l'aperçu dans le CRM. Ni le média ni la légende ne partent dans ce groupe.
3. Jusqu'à l'heure, le propriétaire ou un manager actif peut, dans le CRM : **Valider** (rien ne change, le post part à l'heure ; l'aperçu dit qui l'a vu) ; **Réécrire** (une nouvelle légende, avec ou sans **conseil** : quelques mots libres de l'agence, 300 caractères au plus, qui orientent la réécriture, par exemple « plus taquin, parle du week-end ») ; **Changer de média** (le code reprend le suivant dans le pool) ; **Corriger à la main** ; **Ne pas publier** (le créneau est sauté ce jour-là, le média reste dans le pool). †
4. Le conseil entre dans le prompt dans un bloc délimité et typé, comme une donnée : il oriente le ton et le sujet, il ne lève aucune garde et ne change ni le lien, ni le média, ni l'heure. Il est gardé avec le post au journal. †
5. Toute légende, écrite par le modèle ou corrigée à la main, passe par les mêmes gardes (§ 5). Refusée, elle est réécrite une fois ; si elle échoue encore, le post ne part pas et passe en ambre.
6. Un interrupteur par créatrice, « Publier sans validation », éteint, fait attendre chaque post une validation : sans elle à l'heure, il ne part pas et passe en ambre. Allumé par défaut, comme Charles le veut. †
7. La créatrice a son droit de regard (ADR 0042 § 2), jamais obligatoire.

### 3. Le pool, et la vidéo publique Reveal

1. **Le média vient du pool, choisi par le code, jamais par le modèle de langage** : les dépôts prêts (ADR 0055 § 6) de la catégorie `telegram_post`, puis, dès qu'elle existe, de la catégorie de la vidéo publique Reveal ; jamais publiés sur ce canal ; le plus ancien d'abord. Un média publié sur le canal n'y repart jamais (contrainte unique canal × média).
2. **Vidéo publique Reveal** : c'est la seule exception à « un média ne part que vers la sortie de sa catégorie ». Une vidéo déposée pour un post public vidéo de Reveal peut partir aussi sur le canal Telegram, jamais ailleurs ; le réglage dit « chaque vidéo » ou « une sur N » (une sur deux par défaut) et le délai après sa publication sur Reveal (2 h par défaut). Jamais un média payant, un script, un Mass DM ou une story. La catégorie, sa forme chez Reveal et sa publication viennent des captures de Charles et de CR-08 ; tant qu'elles n'existent pas, l'option est affichée « bientôt » et le pool ne lit que `telegram_post`. †
3. **Pool qui baisse : une demande part seule.** Quand le stock du pool tombe sous le nombre de posts des 7 prochains jours, le code crée une demande de dépôt à la créatrice (ADR 0055 § 4 et § 5), sans attendre personne, avec la catégorie déjà choisie et une phrase en clair (« Ton canal Telegram a de quoi tenir jusqu'à jeudi : quelques vidéos pour la suite »). Une seule demande ouverte à la fois pour ce pool. †
4. **Pool vide** : rien ne part. Le créneau passe en ambre (« Pas de média pour ce créneau »), le groupe « Info » de l'agence est prévenu une fois par jour, et la demande du point 3 existe déjà. Jamais un texte seul, jamais un média déjà publié reposté.
5. Une vidéo de plus de 50 Mo est compressée (720p) avant l'envoi (ADR 0057 § 4).

### 4. Le lien de redirection

1. Chaque créatrice a des **liens de redirection** (`redirect_link`) enregistrés dans le CRM : un nom (« Telegram », « Insta bio »…) et une adresse `https://`. Un seul est le lien du canal ; on change de lien, ou on corrige une adresse, en un geste à l'écran, et le prochain post prend le nouveau. †
2. Le code vérifie la forme (adresse `https://` complète, sans espace, 2 048 caractères au plus) et rien d'autre : la redirection elle-même vit chez le service choisi par l'agence. †
3. Le modèle de langage n'écrit jamais d'adresse ; la garde `contact_info` refuse toute adresse dans la légende ; le code ajoute le lien à la fin du post, sous la forme réglée : un texte court en lien (« Viens me parler ✨ », écrit par l'agence) ou l'adresse nue. Chaque post garde au journal l'adresse qu'il a portée. †
4. Sans lien du canal, aucun post ne part et le réglage est en ambre.

### 5. Le post

1. **La forme Telegram, dans le code.** Le modèle de langage rend un texte structuré (paragraphes et passages marqués gras, italique, souligné, citation, caché) selon un schéma Zod ; le code le transforme en HTML Telegram, échappé, avec ces seules balises. La légende tient dans la limite de Telegram pour un média (1 024 caractères, lien compris). †
2. **La voix** de la créatrice (pour Messa : phrases courtes, un emoji au plus par paragraphe, jamais « mdr », pas de point final) ; à partir de la description validée du média et de la phrase de la créatrice. Prompt versionné `telegram_channel` dans `packages/llm`.
3. **L'appel à venir** est régulier et doit sembler naturel : envie de papoter, une anecdote, un « je réponds à tout le monde ce soir ». Les ressorts de vente (rareté, moment, curiosité) ne s'appuient que sur du **vrai** : aucune fausse échéance, aucune fausse rareté, rien de faux sur le prix (ADR 0057 § 6). †
4. Les gardes bloquantes de l'ADR 0057 § 6 s'appliquent, plus : rien d'explicite (canal public), ni amour ni rencontre, et jamais dire ni laisser entendre qu'une IA écrit (ADR 0021).
5. **Les exemples de l'agence** : Charles donne des posts d'exemple ; ils sont saisis dans le CRM par créatrice, jamais dans le dépôt (ADR 0010), et le prompt en reçoit quelques-uns. Le code refuse une légende identique à l'une des dix dernières du canal. †
6. **Le post paraît venir d'elle** : dans un canal, Telegram montre le nom et la photo du canal, pas le bot ; l'option « signer les messages » du canal doit rester éteinte. L'écran le vérifie quand Telegram le dit et le rappelle sinon. †

### 6. L'écran

Réglages › Créatrices › \<créatrice\> › Canal Telegram, propriétaire seulement :

1. **Canal** : choisi parmi les canaux où le bot de l'agence est administrateur, avec l'état vérifié (« Le bot peut publier » ou, en ambre, ce qui manque). †
2. **Créneaux** : la liste, ajouter, retirer, allumer ; heure et jours ; fenêtre d'aperçu ; « Publier sans validation ».
3. **Liens** : ses liens de redirection, celui du canal, la forme du lien.
4. **Pool** : médias prêts, jours de stock, la demande en cours.
5. **Vidéo publique Reveal** : chaque vidéo ou une sur N, délai (« bientôt » tant que la capture manque).
6. **Exemples** : les posts d'exemple de l'agence.
7. **Prochain post** : l'aperçu tel qu'il paraîtra dans Telegram, avec Valider, Réécrire (avec conseil), Changer de média, Corriger, Ne pas publier.
8. **Journal** : les derniers posts, partis, sautés ou en ambre, leur raison, le lien porté, et les vues lues à 48 h.

Aucun champ n'attend une clé ou un jeton : le jeton reste celui du bot des alertes (ADR 0016, 0057 § 2), créé par la création guidée de Réglages › Telegram.

### 7. Le playground

Le playground (Entraîner) a deux modes : **Chatting** (comme aujourd'hui) et **Post du canal**. En mode Post du canal, on choisit la créatrice, un média du pool ou un média saisi, un conseil facultatif, et l'on voit le post tel qu'il paraîtrait dans Telegram, par le même chemin que la production (prompt, gardes, rendu, lien). Rien ne part. On note ou corrige comme en chatting ; une correction peut devenir un exemple (§ 5.5). †

## Conséquences

Positives :
- Le canal vit chaque jour sans que personne n'y pense, et chaque post ramène vers Reveal par un lien que l'agence change en un geste.
- Le pool se tient seul : la créatrice est prévenue avant qu'il ne manque quelque chose.
- La vidéo publique Reveal sert deux fois sans tournage de plus.

Négatives, à surveiller :
- Un post peut partir sans œil humain. La fenêtre d'aperçu, les gardes de code et l'interrupteur « Publier sans validation » en sont les freins.
- Le lien de redirection est hors de Reveal : ses clics se lisent chez le service de redirection, pas dans Impera.
- La vidéo publique Reveal attend les captures et CR-08.

## Alternatives rejetées

- **Garder l'acceptation de chaque post** (ADR 0057 § 3) : Charles veut que ça parte seul ; pour un canal d'actu sans nu, avec un lien ajouté par le code, la fenêtre d'aperçu suffit, et l'interrupteur la rétablit.
- **Un texte seul quand le pool est vide**, ou **un ancien média reposté** : un canal qui poste sans image ne fait pas venir, et ses abonnés reconnaissent un média déjà vu.
- **Le lien de suivi Reveal en dur** : Charles passe par un service de redirection qui ouvre le navigateur par défaut ; le lien doit pouvoir changer sans code.
- **Un second bot pour la publication** : l'ADR 0057 § 2 a tranché, un seul bot ; le canal montre son propre nom.
- **Un second playground** : un mode de plus dans celui qui existe, par le même chemin.

## Découpage

- **Lot A1** : contrats, migration 0137 (canal, créneaux, liens de redirection, posts du canal), connecteur de publication Telegram et `FakeTelegramChannel`, routes et écran des réglages (canal, créneaux, liens).
- **Lot A2** : prompt `telegram_channel`, rendu HTML, gardes, exemples, mode Post du canal du playground (après les exemples de Charles).
- **Lot A3** : jobs des créneaux, aperçu dans le groupe Info, Valider / Réécrire / Changer / Ne pas publier, demande de dépôt automatique, journal et vues à 48 h.
- **Lot B** : la vidéo publique Reveal, après les captures et CR-08.
