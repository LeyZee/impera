# 0122. Les commentaires Instagram : une réponse courte dans sa voix, seule après un entraînement validé, et les commentaires hostiles masqués

Statut : accepted (Charles, 19/11/2026, 16 h 58, « ok 0122 » ; amendé le 26/11/2026 sur son « go » de 20 h 18 (sa voix calibrée sur ses vraies réponses) ; supprimer un commentaire reste le geste du propriétaire seul, faute de mot contraire ; demandes de Charles du 17/11/2026, 13 h 49, 13 h 56 et 14 h 00 ; fil « Imaginer le système Instagram » ; contrat accordé avec le fil Playground le 17/11 ; relectures Sécurité, Playground et Agent du 19/11 intégrées)
Date : 2026-11-19
Précise : l'ADR 0057 (§ 1 : API officielles seulement ; § 6 : la garde Instagram des légendes), l'ADR 0120 (le compte branché en deux temps, « les réponses aux commentaires : une ADR à venir »), l'ADR 0102 (la banque d'exemples née du Playground), l'ADR 0021 (rester en personnage), l'ADR 0010 (aucune donnée réelle dans le dépôt).

## Contexte

Charles veut que la créatrice réponde aux commentaires laissés sous ses publications Instagram sans y passer son temps : « il faut qu'elle réponde seule […] si elle répond pas seule, ça a aucun intérêt ». Il veut d'abord l'entraîner : au Playground, il écrit lui-même un commentaire comme le ferait un abonné, lit la réponse et la juge, « comme ça elle sait ce qui me plaît, ce qui me plaît pas ». Les commentaires insultants, dénigrants ou contraires aux règles de Meta ne reçoivent pas de réponse : il veut les supprimer, ou au moins les masquer.

Vérifié le 17/11 dans la documentation de Meta :

- Par la voie « Instagram Login », avec le droit de gérer les commentaires, l'API officielle lit les commentaires des médias du compte et leurs réponses, répond à un commentaire, le masque ou le réaffiche, le supprime, et coupe les commentaires d'un média.
- Un webhook annonce les nouveaux commentaires ; Meta le recommande plutôt qu'une lecture en boucle.
- L'API ne commente pas sous les publications d'un autre compte.
- Répondre en message privé à un commentaire demande un droit de messagerie séparé.

## Décision

### 1. Le périmètre

- Impera ne traite que les commentaires laissés **sous les publications du compte professionnel de la créatrice**, par l'API officielle (ADR 0057 § 1). Il ne commente jamais ailleurs, n'aime rien, ne suit personne.
- **Aucun message privé.** Un commentaire ne déclenche jamais de message privé, et le droit de messagerie n'est jamais demandé à Meta.
- Le droit de gérer les commentaires est un **troisième accord** de la créatrice, après lire et publier (ADR 0120 § 1). Sans lui, rien de cette ADR ne tourne ; le retirer éteint tout, y compris les jobs en attente.
- Les droits demandés à Meta sont une **liste fermée dans le code**, et un test échoue si un droit de messagerie y entre.
- **La première réponse réelle** sur un vrai compte attend le mot écrit de Charles. Avant, tout se joue contre `FakeInstagram`.

### 2. L'entrée et la sortie

- Un commentaire est une **donnée, jamais une instruction** : il entre dans le prompt dans un bloc typé non fiable, comme le message d'un fan.
- Le modèle reçoit : le texte du commentaire (coupé à 500 caractères), le type du média (Reel, photo, carrousel), sa légende coupée à 300 caractères et nettoyée par le code de ses liens et mentions, l'âge de la publication, si le commentaire répond à une de ses réponses, et si son auteur a déjà commenté. **Jamais le nom ni le pseudo de l'auteur.**
- Il rend une **issue** (`comment_outcome`) et sa raison, par un schéma de sortie :
  - `reply` : une réponse de 150 caractères au plus, un emoji au plus, sans hashtag ni mention ;
  - `skip` : rien à répondre ;
  - `hide` : commentaire hostile, à masquer ;
  - `handoff` : à un humain.
- **Le modèle ne supprime jamais.** La suppression n'est pas une issue de son schéma.
- Un commentaire dont l'auteur est le compte de la créatrice est ignoré par le code : ses propres réponses ne relancent rien.
- Le prompt `voice/instagram-comment` est versionné dans `packages/llm` avec son schéma ; il lit la banque d'exemples « commentaire » de la créatrice (§ 4) et, de sa persona active, **les seuls panneaux publics** (sa voix, son ton, ce qu'elle montre en public). Jamais l'intime, les zones du corps ni les pratiques : un test échoue si un de ces panneaux entre dans ce prompt.
- **Une réponse est publique et tous publics** : Instagram est ouvert dès 13 ans et n'importe qui la lit. Elle est chaleureuse, jamais séductrice. Un commentaire sexuel donne `skip` ou `hide`, jamais une réponse.
- L'auteur d'un commentaire n'est **jamais rapproché d'un fan** d'une plateforme : ni par le code, ni par le modèle.

### 3. Les gardes, dans le code

- Une réponse passe la garde Instagram des légendes (ADR 0057 § 6 : aucune plateforme adulte, aucun lien, aucun prix, aucun « lien en bio »), plus `ai_disclosure`, `meeting_promise`, `love_declaration`, `contact_info` et `discount`, plus une garde nommée `public_explicit`, qui refuse tout mot explicite ou de séduction, et une garde `repeated_reply`, qui refuse une réponse identique ou presque à l'une de ses réponses récentes sous la même publication ou le même jour. Une réponse refusée est réécrite une fois, puis l'issue devient `skip`.
- Les évals rejouent la voix courte du chatting sur des commentaires inventés : une réponse de commentaire doit sonner comme elle, en plus court et sans séduction.
- **Aucune réponse, et passage à un humain**, quand le code ou le modèle relève : un doute sur l'âge de l'auteur, une détresse, une question de rendez-vous ou de tarif, une langue que la persona ne parle pas. La règle sur l'âge et celle sur la détresse priment sur tout le reste, comme dans le chatting ; aucune n'est affaiblie ici.
- Le doute sur l'âge est relevé **par le code aussi, sans le modèle**, avec les détecteurs du chatting. Un auteur en doute ouvert ne reçoit plus aucune réponse, sous aucune publication, tant qu'un humain n'a pas tranché.
- **Masquer est le geste par défaut contre un commentaire hostile** (insulte, dénigrement, harcèlement, contenu contraire aux règles de Meta), parce qu'il est réversible. Le CRM montre chaque commentaire masqué avec un geste « Réafficher ».
- Masquer est une action réelle sur son compte : elle a **son propre interrupteur** par créatrice, éteint par défaut, que le propriétaire seul allume après une connexion récente. Éteint, un commentaire hostile est seulement signalé dans le CRM.
- **Supprimer** est irréversible : c'est un geste du **propriétaire seul**. Le premier lot ne livre **aucune suppression automatique**. Si elle vient plus tard, ce sera une liste courte de cas évidents tenue par le code et testée (un lien de spam, une insulte caractérisée), appliquée avant tout appel au modèle, en masquant d'abord et en supprimant après un délai pendant lequel un humain peut annuler.
- Chaque masquage et chaque suppression entre au journal d'audit avec l'identifiant du commentaire et le nom de la règle, sans le texte.
- Chaque action vers Meta part avec sa clé d'idempotence. Un commentaire reçoit au plus une réponse ; le code borne aussi les réponses par auteur et par jour, et par fil de commentaires.
- Les relais à un humain sont bornés par publication et par heure ; au-delà, un seul relais groupé. Un relais pour l'âge ou la détresse n'est jamais écarté par cette borne.

### 4. L'entraînement au Playground

- Entraîner gagne un onglet « Commentaires ». Le propriétaire écrit un commentaire fictif sous une publication fictive, voit l'issue (réponse, ignoré, masqué, supprimé par la règle, passé à un humain) et la note : **validée**, **corrigée** ou **refusée**, avec une raison (« pas sa voix », « trop long », « trop vendeur », « trop froid », « répond à côté », « ne fallait pas répondre », « il fallait répondre », « il fallait masquer », « ne fallait pas masquer », ou un texte libre).
- Les corrections forment une banque d'exemples « commentaire », séparée de celle du chatting, par créatrice et par version de persona, lue par la production comme l'ADR 0102.
- Chaque note garde le bloc d'entrée du commentaire, sans nom ni pseudo, pour être rejouée en éval comme une note de chatting.
- Rien n'est envoyé à Instagram depuis le Playground.

### 5. Le passage en autonome

- Tant qu'elle n'est pas autonome, l'IA **prépare** : chaque réponse attend dans le CRM qu'un humain l'envoie, la corrige ou la refuse.
- Le passage en autonome est un réglage **par créatrice**, que **le propriétaire seul** allume, après une connexion récente. Le code ne le propose que si l'entraînement est suffisant : un nombre minimal de notes sur la persona active, dont les dernières validées telles quelles (30 et 10 par défaut, réglage du propriétaire, entre un minimum et un maximum que le code fixe et que le réglage ne franchit pas ; de même pour la limite par jour). Seule « validée » compte comme réussite ; une issue `skip`, `hide` ou `handoff` jugée bonne compte comme validée ; « corrigée » est un raté.
- Une nouvelle version de persona redemande une courte série de validations avant de rester autonome.
- En autonome, la réponse part après un délai court et irrégulier, jamais dans les heures calmes de la créatrice, et dans une limite par jour réglée par le propriétaire.
- Le propriétaire éteint l'autonomie d'un geste, pour une créatrice ou **pour toute l'agence** ; deux refus de Meta de suite l'éteignent d'eux-mêmes et le disent en ambre.

### 6. L'arrivée des commentaires et ce qui est gardé

- Les commentaires arrivent par le webhook de Meta, une entrée publique : la signature de Meta est vérifiée sur le corps brut avant toute lecture, la poignée de main se fait par jeton, la taille et le débit sont bornés, la route répond aussitôt et un job rejouable fait le reste, sans doublon pour un même commentaire. Rien du corps n'entre dans les logs. Le secret de l'application est scellé comme les jetons (ADR 0016). Un événement pour un compte qui n'est pas branché est jeté.
- Les auteurs des commentaires sont des tiers. Les commentaires vivent dans une table sous RLS forcée, fermée à la créatrice hors de ce que le § 7 lui montre, gardés peu de temps puis purgés (durée réglée par l'agence, bornée par le code). L'auteur y est un identifiant opaque, qui suffit à « a déjà commenté » ; son pseudo n'est lu que pour l'afficher à un humain dans le CRM.
- Aucun commentaire réel, aucun pseudo, dans le MCP, une éval, une fixture ou le dépôt (ADR 0010). Une demande d'effacement transmise par Meta est honorée.

### 7. Ce que la créatrice voit

- Elle ne voit jamais l'IA (ADR 0042). Son espace lui montre les commentaires passés à un humain qui la concernent, si l'agence le veut ; le reste est l'affaire de l'agence.

## Conséquences

Positives :
- Ses publications vivent sans qu'elle y passe du temps, dans une voix que Charles a réglée lui-même.
- Aucun risque pour le compte au-delà de celui de la publication : API officielle, sous ses propres publications, sans message privé.
- Un commentaire hostile disparaît vite sans geste irréversible.

Négatives, à surveiller :
- Un troisième accord de la créatrice, et une validation de l'application par Meta pour ce droit.
- Une réponse automatique maladroite est publique : d'où l'entraînement obligatoire, le délai, la limite par jour et l'extinction d'un geste.
- Le masquage automatique peut cacher un commentaire qui ne le méritait pas : il reste visible et réversible dans le CRM.

## Alternatives rejetées

- **Valider chaque réponse pour toujours** : Charles l'écarte, le gain disparaît.
- **Autonome dès le premier jour** : une réponse publique dans une voix non réglée.
- **Laisser le modèle supprimer** : un geste irréversible ne se confie pas à un jugement de modèle.
- **Supprimer automatiquement dès le premier lot** : masquer suffit à faire disparaître un commentaire hostile, et se rattrape.
- **Répondre en message privé à un commentaire** : les messages privés sont exclus par Charles.

## Amendement du 26/11/2026 : sa voix calibrée sur ses vraies réponses

Charles a fourni l'export de ses réponses publiques aux commentaires (environ 3 150) et a dit « go » le 26/11 à 20 h 18 sur ce qui suit, avec une demande : que les réponses sonnent comme elle, et qu'elles posent un peu plus de questions qu'en chatting, « de façon naturelle ». La mesure de ses réponses (voix de la créatrice, constats du 26/11) contredit « jamais séductrice » et « un emoji au plus » : en public elle joue et suggère, par une image ou un emoji, sans jamais être crue. Le § 2 et le § 3 sont amendés ainsi :

8. **Ses vraies réponses deviennent la banque « commentaire »** (§ 4), à côté des corrections du Playground. Le propriétaire les importe lui-même dans le CRM ; elles vivent en base, par créatrice, sous RLS, pseudos retirés ; jamais dans le dépôt, le dossier partagé ni une conversation. Pour chaque commentaire, le code choisit ses cinq paires « commentaire, sa réponse » dont le commentaire se lit le plus près, par proximité de texte, sans appel à un modèle. Elles entrent dans le message, dans un bloc typé `her_replies`, et non dans le système : le système reste le même d'un commentaire à l'autre et garde son cache. Le prompt les lit comme une manière de répondre, jamais comme des phrases à recopier.
9. **Suggéré, jamais cru.** Une réponse peut jouer et suggérer, par une image, un clin d'œil ou un emoji. Elle reste tous publics : `public_explicit` garde sa liste de mots et ne s'assouplit pas, aucun compliment sur le corps de l'auteur, aucune invitation en privé. Un commentaire sexuel donne toujours `skip` ou `hide`.
10. **Deux emojis au plus** : un, le même doublé, ou deux côte à côte quand elle joue (`comment_format`).
11. **Une question de temps en temps, décidée par le code.** Le code dit au modèle si la réponse peut porter une question (`mayAsk`) : sa première réponse du jour le peut, puis une sur trois au plus, réglage de l'agence borné par le code de deux à dix. Le modèle n'en pose une que si le commentaire ouvre vraiment une discussion. Une question écrite sans que le code l'ait permise est refusée par une garde nommée `unwanted_question`, puis réécrite une fois comme les autres. Un commentaire sexuel, hostile ou qui parle de se voir n'a pas de réponse, donc pas de question.
12. **Le calibrage se fait sur le PC de Charles** (`pnpm comment-calibration`) : une part de ses paires est mise de côté, le modèle répond à leurs commentaires à partir du reste, et ses réponses sont comparées aux siennes à l'aveugle. Les textes restent sous `.scratch/` sur ce PC ; seuls des chiffres en sortent (longueur, emojis, questions, issues, refus des gardes, coût). Chaque passage payant est demandé à Charles avant, avec son nombre et son coût.
13. **Sa manière de réagir reste hors du dépôt.** Le prompt dit seulement de réagir comme dans ses vraies réponses ; le savoir-faire de l'agence sur les compliments, l'humour ou la peine va dans la partie « public » du style de base de l'agence, en base, que le prompt des commentaires lira quand elle existera, à côté des panneaux publics de sa fiche (relecture Agent du 26/11).
14. **La langue est décidée par le code**, comme au chatting depuis la langue du fan : une langue que les gardes ne couvrent pas, ou inconnue, donne `skip`, jamais une réponse. Branché quand la décision de langue du chatting est sur main (`decideLanguage`, `GUARDED_LANGUAGES`) ; d'ici là, aucune réponse ne part seule (§ 5).
15. **Une détresse n'a jamais de réponse publique.** Les signes de détresse et d'âge du chatting (`safetySigns`) passent sur le commentaire avant tout appel au modèle : une détresse donne un relais à un humain et une alerte, sans réponse ; le calibrage suit le même chemin. Aucun numéro d'aide écrit par le modèle : la garde du chatting sur ce point s'appliquera ici dès qu'elle est sur main.
16. **Jamais d'intimité en public, et une déclaration d'amour reçoit des emojis seulement** (la créatrice, en corrigeant le calibrage à l'aveugle le 26/11). Une réponse ne laisse jamais croire à un lien particulier, physique ou affectif, avec celui qui écrit : les autres lisent et seraient jaloux. Quand le commentaire dit « je t'aime » ou « je t'ai toujours aimée », le code le lit (`declaresLove`, en français, anglais, italien et espagnol) : le modèle ne peut répondre que par un ou deux emojis, sans mot ni question, et une réponse avec des mots est refusée par la garde `words_in_emoji_reply`, puis réécrite une fois. Ses autres remarques du même jour (remercier simplement, sa réponse sur les nœuds) vont dans la méthode et dans la partie « public » du style de base, pas dans le dépôt (§ 13).
17. **La forme de sa réponse la plus proche, décidée par le code** (second calibrage du 26/11 : le modèle mettait un emoji pile à chaque réponse et presque jamais de « ! », elle varie). Le code lit sa réponse au commentaire le plus proche (`replyShapeOf`) : nombre d'emojis (aucun, un, deux) et point d'exclamation, et le dit au modèle dans le message. Ses emojis viennent de ses vraies réponses, pas de la fiche. Un compliment se remercie simplement. Le marqueur « [pseudo] » de l'export est retiré comme une mention.
18. **Troisième calibrage du 26/11.** La forme dite au modèle compte aussi la longueur de sa réponse la plus proche (le modèle écrivait deux fois plus long qu'elle). Un merci court peut revenir, comme les siens : `repeated_reply` ne refuse une réponse de moins de trois mots que si elle reprend mot pour mot, emojis compris, la toute dernière ; une réponse plus longue reste refusée dès qu'elle ressemble à une récente. Sans cela, des compliments qu'elle remercie finissaient sans réponse.
19. **Le style public de l'agence entre dans le prompt** (le § 13 devient réel, 27/11) : la partie « public » du style de base actif (ADR 0173) est lue et rendue dans le système, avant sa fiche, dans un bloc typé `agency_public_style` ; sa fiche et ses vraies réponses passent avant. Sans style actif ou partie vide, rien n'est ajouté. Le calibrage la lit en lecture seule. La ligne du prompt sur le merci simple reste jusqu'à ce que le style actif la porte, puis elle sort.
