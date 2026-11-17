# 0137. Le Mass DM part seul : une annonce à tous après chaque publication du feed, un réveil avec un média demandé exprès quand plus personne ne parle

Statut : accepted (Charles, 16/11/2026, 16 h 13 Paris, « ok 0137 » ; demande du même jour, 15 h 50, fil « Publier posts et stories automatiquement »). Amendement du même jour (ses précisions de 17 h 19 et 17 h 20 : annonce à tous, réveil avec un média demandé exprès, Mass DM planifiés avec les publications, équipe prévenue) : accepted (« ok 0137 bis », 16 h 22 Paris). Second amendement (§ 2 bis, après sa réponse de 17 h 24 : trois types de plus, aucun Mass DM payant, ne jamais submerger un fan) : accepted (« ok 0137 ter », 17 h 26 Paris).
Date : 2026-11-16
Amende : ADR 0044 § 5 (le Mass DM ne part plus seulement d'un dépôt Relance : il peut être un texte qui accompagne une publication).
S'appuie sur : ADR 0140 (demande hebdomadaire des médias de Relance, fil Médias).
Précise : ADR 0110 § 5 et § 6 (Mass DM marqué « envoyé à tous », pas de relance de l'agent dans les 6 h), ADR 0136 (publication du feed), ADR 0126 (silence pendant un live).

## Contexte

Charles envoie un Mass DM à chaque publication du feed : « regarde ce que je viens de poster, tu en penses quoi ? ». C'est une relance naturelle des fans qui ne parlent plus. Ses règles : seulement aux abonnés et anciens abonnés, et seulement à ceux qui n'ont pas d'échange de messages récent. Il veut aussi un Mass DM de réveil quand il n'y a plus assez de fans actifs (« coucou toi, tu es là ? »).

Un Mass DM est un envoi réel à de vrais fans, en nombre. Il passe donc par les gardes du chatting, pas seulement par celles de la publication.

La capture du 16/11 (lue pour sa forme seulement) montre : la création d'un Mass DM programmé (texte, médias, prix, listes incluses et exclues), sa suppression, une estimation de l'audience par filtres (abonnés actifs, dépense, ancienneté, en ligne, renouvellement coupé), et les listes de fans (statiques ou dynamiques, ajout d'un fan à une liste statique). Elle ne montre ni filtre « anciens abonnés », ni filtre « sans échange récent », ni le retrait d'un fan d'une liste.

Le même jour, à 17 h 19 et 17 h 20, Charles a précisé : l'annonce d'une nouvelle publication part à tous les abonnés et anciens abonnés, même ceux qui ont parlé récemment ; le réveil s'appuie sur des photos ou vidéos sexy demandées exprès à la créatrice chaque semaine, hors séances, en quantité que le système calcule ; les Mass DM se planifient avec les publications de la semaine ; et l'équipe doit savoir quand part le prochain Mass DM.

## Décision

### 1. Deux Mass DM automatiques, planifiés avec la semaine

- **Annonce** : un Mass DM par publication du feed (ADR 0136), jamais pour une story. Il part **30 minutes après que Reveal a confirmé la publication**, jamais avant. Un index unique (publication → Mass DM) garantit qu'une publication n'en a jamais deux.
- **Réveil** : il part quand, pendant les heures d'activité de la créatrice, **moins de 5 fans ont écrit dans les 3 dernières heures** (seuil et fenêtre réglables par créatrice), ou quand aucun Mass DM n'est parti depuis 5 jours. Au plus un réveil tous les 3 jours, jamais le jour d'une annonce.
- Le plan de la semaine (ADR 0136 § 6) montre les annonces à côté de leurs publications et des créneaux de réveil possibles, et le propriétaire les valide avec elle. Le code place un Mass DM **de préférence sur un créneau où un chatteur est en shift**, puisque les réponses arrivent dans l'heure qui suit.

### 2. Qui le reçoit : une liste tenue par le code

- Le code calcule la liste lui-même, puis la donne à Reveal comme **liste statique** créée pour ce Mass DM (`POST /fan-lists`, puis un ajout par fan), avec le nom « Impera · annonce · date » ou « Impera · réveil · date ».
- **Annonce** : tous les **abonnés et anciens abonnés** (selon ce que Reveal permet d'écrire), qu'ils aient parlé récemment ou non. Seuls en sortent ceux qui ont écrit dans les **30 dernières minutes** : un Mass DM au milieu d'une conversation vivante la casserait.
- **Réveil** : les abonnés et anciens abonnés sans aucun message échangé depuis **72 heures** (réglage par créatrice). Reveal ne sait pas faire ce filtre lui-même.
- Dans les deux cas, le code en **retire toujours**, en lisant le même état que l'agent et jamais une liste à part : un fan en doute d'âge (âge contesté ou mineur possible signalé) ; un fan en mode soin ou fragile, ou encore en sortie de soin (ADR 0088 § 7) ; un fan aux ventes gelées (dépendance ou difficulté, ADR 0132) ; un fan parti en plein sexto qui n'est pas revenu (l'agent attend son retour après une seule relance) ; un fan marqué « ne plus écrire » ou exclu des Mass DM dans Reveal ; un fan au milieu d'un script ; un fan au rythme économe si l'ADR 0135 est acceptée.
- **Plafond par fan** : voir § 2 bis.

### 2 bis. Trois types de plus, et jamais un fan submergé

- **Réveil « en ligne »** : une variante du réveil, envoyée seulement aux fans silencieux depuis 72 h **et connectés à ce moment** (filtre « en ligne » de Reveal), pendant un shift. Les réponses arrivent tout de suite et un chatteur est là.
- **Gros dépensier endormi** : les fans au-dessus du seuil de dépense des gros dépensiers (ADR 0132), silencieux depuis 14 jours. Un texte très personnel, sans média et sans vente, le soir. Il démarre sur 10 fans au plus, puis s'élargit si les réponses suivent.
- **Merci de fidélité** : les abonnés depuis plus de 90 jours, une fois par trimestre au plus pour un même fan. Un merci et une photo de Relance offerte.
- **Aucun Mass DM payant automatique** (décision de Charles du 16/11 : ça casse le « temps présent »). Un Mass DM payant reste à la main, et aucun prix réduit n'est jamais utilisé.
- **Plafond, tous types confondus** : **3 Mass DM automatiques par semaine au plus** pour un même fan, et **jamais deux à moins de 36 heures**.
- **Priorité**, quand plusieurs Mass DM visent le même fan : annonce, puis gros dépensier endormi, puis réveil (en ligne ou non), puis merci de fidélité. Le moins prioritaire saute pour ce fan, sans être reporté.
- **Lassitude** : un fan qui n'a répondu à aucun de ses 3 derniers Mass DM n'en reçoit plus pendant 14 jours, annonce comprise. Le premier message qu'il écrit lève cette pause.
- **Au bon moment** : la liste et le Mass DM ne sont créés dans Reveal que **10 minutes avant le départ**, pour que la liste reflète l'instant (un fan qui vient d'écrire en sort). Un Mass DM programmé peut être supprimé dans Reveal avant de partir (vu dans la capture) : le code le supprime si son but tombe (publication retirée, live, « Arrêt »). La suppression d'un Mass DM déjà reçu par les fans n'a pas été vue : on ne la promet pas. Reveal fait déjà disparaître chez le fan un Mass DM resté sans réponse au bout de 7 jours (ADR 0110).

### 3. Ce qu'il dit

- Le texte est écrit par le modèle de langage dans la voix de la créatrice. **Annonce** : texte seul, qui s'appuie sur la description de la publication (ADR 0083) et finit par une question (« j'ai sorti la lingerie rouge, t'en penses quoi ? »). Si Reveal refuse un Mass DM sans média, l'annonce prend une photo de la publication qu'elle annonce. **Réveil** : court et doux (« coucou toi, t'es là ? »), avec **un média de Relance** (catégorie `mass_dm`, ADR 0055), décrit avant d'être choisi (ADR 0083). Ce média est gratuit et ne repart jamais : l'index de l'ADR 0044 § 5 s'applique.
- Le texte reste au plus suggestif, jamais explicite : des destinataires ont un âge non confirmé.
- Il passe par les mêmes gardes de voix que l'agent (`ai_disclosure` comprise), jamais par une liste propre au Mass DM. Le code refuse en plus : un prix, un lien, un média vendu, une promesse de rencontre, et une phrase déjà envoyée en Mass DM par cette créatrice dans les 30 derniers jours.
- Le prix d'un Mass DM automatique est toujours 0 : un Mass DM payant reste à la main (ADR 0044 § 5).
- **La demande de médias de Relance** : une fonction pure du module des Mass DM, `relanceNeedFor(créatrice, semaine)`, rend le nombre de médias de Relance qu'il faudra la semaine suivante : les réveils probables (moyenne des quatre dernières semaines, au moins 2 et au plus 3), moins le stock de Relance déjà déposé et pas encore envoyé. La semaine de la créatrice (ADR 0140) lit ce nombre au calcul du dimanche et le place après le feed. Sans média de Relance, le réveil part en texte seul.

### 3 bis. L'équipe est prévenue

- Une carte « Prochain Mass DM » apparaît sur Aujourd'hui du chatteur : l'heure dans son fuseau à lui, la sorte (annonce ou réveil) et le sujet, sans le média. Un repère apparaît sur son Planning (fils Équipe et Design).
- Dans le copilote, la réponse d'un fan à un Mass DM est signalée, avec ce Mass DM (fil Extension).
- Le propriétaire et les managers voient les Mass DM de la semaine au Dashboard : l'heure, la sorte, le nombre de destinataires.

### 4. Ce que l'agent en fait

- Le Mass DM est marqué « envoyé à tous » dans le contexte de l'agent et n'est jamais cité comme un message personnel (ADR 0110 § 5). Une réponse du fan est traitée comme toute réponse.
- Aucune relance de l'agent ne part dans les 6 heures qui suivent (ADR 0110 § 6).
- Aucun Mass DM ne part pendant la fenêtre d'un live (ADR 0126), ni quand le Dashboard est sur « Arrêt ». Un Mass DM prévu dans ces moments est décalé ou abandonné, jamais envoyé en retard de plus de 3 heures.

### 5. Qui valide

- Même deux modes que l'ADR 0136 § 6. En **« À valider »** (par défaut, obligatoire pendant les deux premières semaines), le propriétaire ou un manager actif voit le texte, le nombre de destinataires et les exclusions avant d'accepter. En **« Automatique »** (propriétaire seul, journalisé), il part seul ; on peut le retirer tant qu'il n'est pas parti.
- **Le premier Mass DM réel** attend le mot écrit de Charles dans le fil qui l'exécute, qui nomme l'action et le compte, et il part vers **une liste qui ne contient que le compte fan « test »**.

### 6. Fiabilité

- Clé d'idempotence par Mass DM. Si la réponse de Reveal se perd, le code relit la liste des Mass DM avant toute nouvelle tentative et ne renvoie jamais à l'aveugle : ambre avec sa raison (ADR 0044 § 5).
- **Une liste par envoi** : chaque Mass DM part vers une liste statique créée pour lui (nom daté), remplie par le code 10 minutes avant, puis supprimée après l'envoi. Les filtres de Reveal (« en ligne », dépense, ancienneté, listes dynamiques) s'ajoutent seulement quand ils disent exactement ce que veut la règle, par exemple « en ligne » pour le réveil « en ligne ». Nos exclusions (§ 2) passent toujours par la liste du code, jamais par un filtre de Reveal.
- Formes vues dans les captures du 16/11 : création d'une liste (`POST /fan-lists`), ajout d'un fan (`POST /fan-lists/:id/members`), suppression (`DELETE /fan-lists/:id`, une liste supprimée répond ensuite « introuvable »). Créer, remplir ou supprimer une liste est une écriture sur le compte : rien sur le vrai compte avant le mot de Charles, et les essais se font avec le seul compte fan « test ».
- Un ajout de fan qui échoue retire ce fan de l'envoi : la liste envoyée est toujours celle que le code a vérifiée.

### 7. Mesurer

- Pour chaque Mass DM : nombre de destinataires, réponses dans les 24 h, achats dans les 48 h (le `totalIncome` de Reveal et nos transactions), fans qui se désabonnent dans les 72 h. Une alerte ambre se lève si les désabonnements après un Mass DM dépassent 2 % des destinataires.

### 8. Le connecteur

- Capacités facultatives du port (ADR 0044 § 6), d'après la capture du 16/11 : `createFanList`, `addFanToList`, `estimateMassDmAudience`, `sendMassDm` (texte, médias facultatifs, heure, listes incluses et exclues, prix 0), `deleteMassDm`, `listMassDms`. `FakeReveal` d'abord.

## Conséquences

Positives :
- Chaque publication est annoncée à tous ses abonnés, et chaque réveil apporte un média neuf, sans travail à la main.
- Les fans en doute d'âge, fragiles ou en pleine conversation ne reçoivent jamais un message de masse, et l'équipe sait quand le prochain part.

Négatives, à surveiller :
- Un message de masse trop fréquent fait partir des fans : plafond par fan, alerte sur les désabonnements.
- Une liste par Mass DM, ajoutée fan par fan, fait beaucoup d'appels à Reveal : à mesurer sur le faux Reveal puis sur « test ».

## Alternatives rejetées

- **Laisser Reveal choisir les destinataires avec ses filtres** : ils ne savent pas exclure un fan en doute d'âge ni un fan qui parle en ce moment.
- **Un Mass DM avec média payant** : il resterait de la vente à l'aveugle, contraire à « relation avant vente ».
- **Un Mass DM pour chaque story** : trop fréquent.
