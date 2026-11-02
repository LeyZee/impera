# 0044. Feed et Mass DM : la créatrice dépose son contenu dans Nirvana, l'agent le téléverse et le planifie à la semaine

Statut : accepted (Charles, 02/11/2026 16h17, « ok 0044 » ; cadrage du même jour, fil « Concevoir les espaces modèle et chatteur mobiles »)
Date : 2026-11-02
Remplace : dans l'ADR 0030 § 2, les mots « Nirvana ne téléverse rien vers une plateforme et n'a pas de dossier à lui », et dans l'ADR 0030 § 4, la règle « Fichiers : on garde le minimum », **pour le seul contenu déposé pour le feed et les Mass DM**. Pour tout le reste (scripts, médias privés vendus en message), l'ADR 0030 s'applique telle quelle : le coffre de la plateforme fait foi. L'ADR 0030 reste telle quelle ; l'index des ADR renvoie d'elle à celle-ci.

## Contexte

Sur Reveal, l'abonnement est gratuit et le feed public fait venir de nouveaux fans : chaque publication apparaît à tous, et tout l'enjeu est de leur donner envie de venir parler à la créatrice. Aujourd'hui, la créatrice ou l'agence publie à la main.

Le 02/11, Charles a fixé (document de cadrage du 02/11, questions C1 à C13) :

- la créatrice dépose ce qui va sur le feed **dans un dossier de Nirvana**, pas dans Reveal : « c'est l'IA qui l'upload sur Reveal à partir d'un dossier dédié dans Nirvana » ;
- à chaque dépôt, elle dit ce que c'est : une **séance** (boudoir : plusieurs photos et quelques petites vidéos), qui fait **une seule publication**, ou une **vidéo** plus longue, façon reel ;
- l'IA publie **au moins une fois par jour**, réglable, aux heures où les fans sont le plus actifs, et s'adapte d'une semaine à l'autre ; Reveal permet de **programmer** des publications, donc l'IA planifie la semaine, qu'on **accepte d'un coup** ou qu'on modifie jour par jour ;
- la visibilité (publique ou abonnés) est réglable ;
- la **légende** est écrite par l'IA dans la voix de la créatrice : courte, naturelle, cohérente avec ce qui se passe dans la vidéo, toujours avec une petite question ouverte pour donner envie de venir parler le soir ;
- on mesure tout ce que Reveal donne sur une publication, et ce qui a marché nourrit la to-do de la créatrice ;
- **pas de contrôle de nudité** : « la modèle sait ce qu'elle doit poster », « on n'est pas là pour les fliquer » ;
- les **Mass DM** suivent le même mécanisme : elle dépose des médias, l'IA envoie selon les listes de fans de Reveal, et **un même média n'est jamais renvoyé** ; la réutilisation de médias anciens se travaillera plus tard.

Rien de cela n'est encore observé dans Reveal : ni le téléversement, ni la publication, ni la programmation, ni les statistiques d'une publication, ni les listes et les Mass DM. Charles a accepté que la capture Reveal inclue une publication de test et la lecture de ses statistiques (C9).

## Décision

### 1. Le dépôt de contenu

- Un **dépôt** (`content_drop`) appartient à une créatrice, a un usage (`feed` ou `mass_dm`) et, pour le feed, une sorte : **séance** (`shoot` : photos et courtes vidéos, une publication) ou **vidéo** (`video` : une vidéo, une publication). Elle peut y ajouter une phrase sur ce qu'elle a fait, que la légende reprend.
- Elle dépose depuis son téléphone, dans Contenu (ADR 0042 § 8) ; le propriétaire peut déposer pour elle.
- Chaque fichier part du téléphone directement vers le stockage, par une adresse signée en plusieurs parties, sans passer par le serveur d'API, avec une taille maximale par fichier. L'empreinte `sha256` qui sert à reconnaître un fichier déjà déposé est calculée par le serveur après l'envoi, jamais reçue du téléphone.
- Chaque fichier devient un média de la médiathèque (empreinte `sha256` unique par créatrice, ADR 0030 § 1) et reçoit sa description par le rôle `sense` (ADR 0030 § 3), qui sert à la légende et au suivi de ce qui a été envoyé. Un fichier déjà déposé (même empreinte) n'est pas repris.
- Aucun contrôle de ce que montre le contenu : c'est l'affaire de la créatrice et de l'agence.

### 2. Conservation des fichiers déposés

- Les originaux sont gardés dans le stockage objet de production, privé et chiffré, sous la créatrice, **jusqu'à leur publication ou leur envoi, puis 30 jours**. Ensuite on n'en garde que ce que garde l'ADR 0030 § 4 : l'empreinte, la durée, le type, une vignette et la description.
- Ils vivent dans un compartiment à part, **sans verrou d'objet** : celui des factures (ADR 0037) est verrouillé dix ans et n'effacerait jamais rien. Chaque original porte sa date d'effacement en base ; un job rejouable l'efface à cette date, et une règle de cycle de vie du compartiment sert de filet. Un effacement refusé passe en ambre, jamais en silence.
- Un dépôt jamais publié reste tant que la créatrice ou l'agence ne le retire pas. Retirer un dépôt efface ses originaux ; sa trace reste au journal.

### 3. La semaine de publications

- Avec le topo de la semaine (ADR 0042 § 5), le code bâtit un **plan de publication** (`post_plan`) : pour chaque jour, au moins le nombre de publications réglé pour la créatrice (1 par défaut), à l'heure où ses fans ont été le plus actifs les semaines passées (messages entrants et achats par heure, calculés par le code ; 20 h tant qu'il n'y a pas d'historique), en prenant les dépôts les plus anciens d'abord et sans deux sorts identiques d'affilée. La visibilité vient d'un réglage par créatrice, modifiable publication par publication.
- Le modèle de langage n'écrit que la **légende**, à partir de la description validée la plus récente et de la phrase de la créatrice, dans sa voix, avec les gardes de voix existantes et un schéma de sortie : courte, naturelle, cohérente avec le contenu, terminée par une question ouverte. Il ne choisit ni l'heure, ni le nombre, ni le contenu.
- Le propriétaire (ou un manager actif) **accepte la semaine d'un geste** ou modifie une publication (contenu, légende, heure, visibilité) ; la créatrice a son droit de regard, jamais obligatoire (ADR 0042 § 2).
- À l'acceptation, chaque publication part par le connecteur : téléversement des fichiers, puis **programmation** dans Reveal à son heure, avec une clé d'idempotence par publication ; la garde d'écriture de l'ADR 0018 s'applique. Si Reveal ne sait pas programmer, un job publie à l'heure. Un échec ne republie jamais à l'aveugle : la publication passe en ambre avec sa raison.

### 4. Mesurer ce qui marche

- 48 h après chaque publication, le code lit ce que Reveal en dit (j'aime, commentaires, vues, abonnés gagnés, ventes par lien de suivi : la liste exacte vient de la capture) et la compare à la médiane des publications de la créatrice sur 30 jours. Dans le quart du haut, elle devient un exemple « à refaire » pour le topo de la semaine ; le modèle de langage ne fait que nommer le genre (tenue, lieu, ambiance) à partir des descriptions.
- Rien n'est dit à la créatrice sur ce qui n'a pas marché (ADR 0042 § 5).
- Quand le plan à venir couvre moins de 7 jours de publications, le topo propose une fiche de tournage pour le feed.

### 5. Les Mass DM

- Même dépôt (`mass_dm`), même plan à la semaine, même acceptation, même départ par le connecteur, vers une **liste de fans** lue dans Reveal.
- **Un média n'est jamais renvoyé**, et la base l'impose : un index unique sur le média pour l'usage `mass_dm`, et le média est marqué utilisé dans la même transaction que la mise en file de l'envoi, avec sa clé d'idempotence. La projection « vu par ce fan » de l'ADR 0030 § 5 s'applique à chaque destinataire. La réutilisation de médias anciens demandera sa propre décision.
- Comme pour le feed, un échec ne renvoie jamais à l'aveugle : un Mass DM dont la réponse de Reveal se perd passe en ambre avec sa raison et n'est jamais relancé par le code.
- Le prix éventuel d'un Mass DM, le choix des listes et la cadence se décident avec Charles dans la fiche du lot Mass DM, avant le code ; ils vivent dans le code, pas dans un prompt.

### 6. Ce que le connecteur doit apprendre

- Le port gagne des capacités facultatives, déclarées par des drapeaux comme dans l'ADR 0018 : téléverser un média, publier ou programmer une publication avec sa visibilité, lire les statistiques d'une publication, lire les listes de fans, envoyer un Mass DM. Leurs formes sont arrêtées d'après la capture, par le propriétaire de `packages/contracts` et du module `connectors`, avec `FakeReveal` d'abord.
- Le cœur ne connaît ni la forme Reveal ni ses dossiers (ADR 0003).
- La session Reveal qui publie et envoie les Mass DM est celle du compte de la créatrice, jamais celle de Charles ni celle du membre « bot » ; l'ADR de la capture Reveal le fixera.

## Conséquences

Positives :
- La créatrice dépose une fois depuis son téléphone ; le reste (légende, heure, publication, mesure) est fait pour elle, et l'agence garde la main en un geste par semaine.
- Ce qui marche revient dans sa to-do, chiffres à l'appui.
- Un média n'est jamais envoyé deux fois en Mass DM, par la base et pas par la mémoire d'un humain.

Négatives, à surveiller :
- Nirvana garde des originaux intimes pendant des jours : stockage chiffré, accès par la seule créatrice et l'agence, effacement daté, chaque lecture au journal.
- Tout dépend de la capture Reveal : rien de ce lot ne part avant elle.
- Publier au nom de la créatrice est une écriture publique : la garde d'écriture et l'acceptation humaine de la semaine restent obligatoires tant qu'une ADR ne dit pas le contraire.

## Alternatives rejetées

- **Déposer dans le coffre de Reveal et laisser Nirvana choisir dedans** (recommandation initiale) : Charles veut un dossier de travail dans Nirvana, et le contenu du feed n'a rien à faire dans le coffre avant sa publication.
- **Découper une séance en plusieurs publications** : une séance est une publication (Charles, C12).
- **Un contrôle de nudité par l'IA de vision** : refusé par Charles (C3, C11) ; la créatrice et l'agence savent ce qui va sur le feed.
- **Publier sans acceptation humaine** : plus tard peut-être, par une ADR, avec un seuil, comme l'Automatique du chatting.
