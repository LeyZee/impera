# Test à l'aveugle avant l'Automatique (ID à valider par Charles)
Statut : proposed (demande du coordinateur le 28/10 à 8h17 ; ID à valider par Charles)
Phase : 3
Dépend de : ADR 0034 (proposée), capture Reveal (des réponses humaines réelles à comparer), P3-08 (recette du copilote), clé xAI ; ADR 0019, 0022, 0023
Branche : claude/project-thread-e0j3ow

## Objectif
Faire du test à l'aveugle exigé par les ADR 0019 et 0022 une séance outillée et reproductible, plutôt qu'un taux tapé à la main. La créatrice juge des réponses sans savoir qui les a écrites. Le serveur calcule le taux « sans retouche » des réponses de l'agent et l'enregistre dans `blind_tests` pour la version active de la voix et de la persona. C'est la troisième condition du verrou de l'Automatique, après 80 % en réel sur au moins 100 brouillons décidés.

## Ce qui existe déjà
- `blind_tests` (append-only) et `POST /v1/creators/:id/blind-tests { rate }` : propriétaire seul, connexion de moins de 10 minutes, version et persona posées par le serveur, ligne `audit_log` (`docs/architecture/message-flow.md` §6).
- Le verrou `automaticGate` (`packages/contracts/src/automatic.ts`) lit le dernier test de la version. Le Dashboard dit ce qui manque.
- Le playground sait rejouer une situation sur le vrai chemin de l'agent sans rien envoyer (`/v1/playground`, `compare`).
- Les messages capturés portent leur auteur (`messages.author` : `fan`, `human`, `ai`) et, quand ils viennent d'un brouillon, son identifiant (`messages.draft_id`). Attention : un brouillon de l'agent retouché par un chatteur sort avec `author = 'human'` (`conversations/application/jobs/send.ts:121`). `author` seul ne suffit donc pas à reconnaître une réponse écrite par une personne.
- Les faits du fan sont datés (`fan_facts.observed_at`, append-only avec `superseded_by`), ses limites ont leurs événements (`fan_flag_set`, `fan_flag_cleared`), sa note de désir aussi (`desire_scored`), et chaque résumé dit sur quel message il s'appuie (`fan_summaries.based_on_message_id`).

Ce qui manque : le jeu de cartes, le masquage, l'écran de jugement, le calcul du taux par le serveur.

## Protocole proposé

### Qui juge
- **La créatrice elle-même** (Messa pour Messalina), comme l'écrit l'ADR 0019. Elle connaît sa voix mieux que personne.
- **Sur la session du propriétaire**, à l'écran de Charles, et pas sur un compte créatrice. C'est une **exception à l'ADR 0023**, qui dit qu'une créatrice ne voit jamais une conversation ni un fan : ici, elle voit des extraits de conversations réelles, noms masqués. Aucun droit d'un compte créatrice n'est élargi. L'exception est écrite dans l'ADR 0034 et attend la décision de Charles (question 1). Sans son accord, le test se fait sur des conversations inventées et la fiche est revue.
- Charles ne commente pas pendant la séance. Il clique « Suivant » si elle le lui demande, et c'est tout.

### Les paires
- **50 situations réelles, 100 cartes.** Une situation, c'est la fin d'une conversation réelle au moment où le fan attend une réponse : ses 6 derniers messages au plus, et rien de plus ancien.
- Chaque situation donne deux réponses :
  - **humaine** : ce qu'un chatteur a écrit lui-même dans Reveal à ce moment-là. C'est toutes les bulles consécutives de `author = 'human'` après le dernier message du fan, jusqu'au message suivant du fan, et **aucune ne vient d'un brouillon** (`draft_id` nul). Une réponse dont une seule bulle vient d'un brouillon, retouché ou non, écarte la situation : sinon la référence humaine contiendrait du texte de l'agent, et le test se comparerait en partie à lui-même ;
  - **agent** : ce que la version active écrit sur la même situation, rejouée sur le vrai chemin (brain, voix, gardes), sans rien envoyer, **avec le fan tel qu'il était à la date de la situation** (voir « Le rejeu à la date de la situation »).
- **Tirage** :
  - 50 conversations différentes, un seul fan par conversation, tirées au hasard parmi celles des 60 derniers jours qui ont une réponse humaine ;
  - un quota par moment de la relation, pour ne pas tester que du bavardage : environ 15 relation et KYC, 10 flirt, 10 sexto ou intime, 10 refus ou objection de prix, et 5 sujets délicats (demande de rencontre, « t'es un bot ? », hors sujet) ;
  - exclus :
    - les situations avec détresse, mineur présumé ou passation (l'agent ne répond pas, il passe la main) ;
    - celles qui demandent l'envoi d'un média ou d'une étape de script (l'agent n'en envoie pas pendant le test) ;
    - celles dont la réponse humaine contient un média, un PPV ou une étape de script, même si la situation ne les demandait pas : la forme trahirait l'auteur ;
    - celles dont la réponse humaine vient, même en partie, d'un brouillon ;
    - celles qu'on ne peut pas reconstruire à leur date (voir ci-dessous) ;
    - celles déjà jugées par la créatrice dans une séance des 30 derniers jours, quel que soit l'état de cette séance (`done` ou `abandoned`) : elle reconnaîtrait les réponses.
- **Seuil de taille** : le test n'est valide qu'avec au moins 40 situations jugées. Si le tirage en trouve moins de 40, la séance ne s'ouvre pas, et l'écran dit combien il en manque.

### Le rejeu à la date de la situation
L'agent ne doit savoir que ce que le chatteur savait à ce moment-là. Le rejeu du playground lit l'état actuel du fan, ce qui ne convient pas : un fait appris plus tard, un gel ou un curseur posé ensuite, une offre déjà faite fausseraient la carte de l'agent. Pour une situation à la date t (le dernier message du fan) :
- **faits** : ceux observés avant t (`observed_at < t`), en prenant pour chaque clé le dernier observé avant t, même s'il a été remplacé depuis ;
- **limites** : rejouées à partir des événements `fan_flag_set` et `fan_flag_cleared` antérieurs à t ;
- **note de désir** : le dernier `desire_scored` antérieur à t, ou aucune ;
- **résumé** : la dernière version dont le message d'appui est antérieur à t, ou aucun ;
- **historique** : les messages antérieurs à t seulement ;
- **horloge** : l'agent rejoue à l'heure t, pour les heures calmes, les créneaux et les cooldowns.

Si l'un de ces éléments ne peut pas être reconstruit (événements manquants, données purgées), la situation est écartée et remplacée par la suivante du tirage. Aucune n'est rejouée avec l'état actuel.

### Le masquage
- **Même forme** pour les deux auteurs :
  - même découpage en bulles (la règle `behavior.split_messages` de sa persona appliquée aux deux) ;
  - pas d'heure ni de délai de réponse ;
  - pas d'accusé de lecture ;
  - aucune marque « modifié », « IA » ou « brouillon ».
- **Les noms partout** : les prénoms et pseudonymes du fan sont remplacés par « Fan A », « Fan B »… dans le contexte **et dans le texte des deux réponses**, de la même façon. Un chatteur écrit souvent le prénom (« coucou Julien »), et l'agent le connaît par ses faits : un prénom réel d'un côté, ou son absence, trahirait l'auteur. Le remplacement part du nom affiché du fan et des faits de prénom actifs à la date de la situation : `first_name` (la clé de la case Prénom depuis le cerveau 1.10.0) et `name` pour les faits plus anciens, insensible à la casse et aux accents.
- **Rien de corrigé** : ni fautes ni emojis ne sont retouchés, d'un côté comme de l'autre. On compare des réponses telles qu'elles partiraient.
- **Ordre aléatoire** : les 100 cartes sont mélangées. Les deux réponses d'une même situation ne se suivent jamais, avec au moins 10 cartes entre elles. Le tirage est fixé par une graine enregistrée, pour pouvoir rejouer la séance à l'identique.
- **Une carte à la fois** : le contexte de la conversation, puis la réponse. Elle ne voit jamais deux réponses côte à côte, qui se trahiraient l'une l'autre.
- Si la voix refuse ou si une garde bloque sur une situation, la carte de l'agent ne sort pas. La situation entière est remplacée par la suivante du tirage, pour ne pas laisser une carte humaine seule.

### Ce qu'elle répond, par carte
1. « Je l'enverrais telle quelle » / « Je la retoucherais » / « Je ne l'enverrais jamais ».
2. Facultatif : « Qui l'a écrite, à ton avis ? » (« Une personne » / « L'agent » / « Je ne sais pas »).

Elle peut revenir sur la carte précédente, jamais plus loin. Une séance peut se faire en deux fois : l'avancement est gardé, le tirage aussi.

### Le seuil de réussite
- **Ce qui ouvre l'Automatique**, conformément à l'ADR 0019, sans rien y changer :
  - le taux = part des cartes de l'agent jugées « telle quelle » ;
  - il faut au moins 80 % ;
  - il est calculé par le serveur et enregistré dans `blind_tests` par le propriétaire, à la fin de la séance.
- **Ce qui n'ouvre rien mais est rangé avec le test** :
  - le taux « telle quelle » des cartes humaines, comme référence (si les chatteurs font 70 %, un agent à 80 % est au-dessus d'eux) ;
  - le taux de « jamais » de l'agent : au-delà de 5 %, l'écran l'écrit en ambre (une réponse qu'elle n'enverrait jamais est plus grave qu'une retouche) ;
  - la part de bonnes devinettes sur l'auteur : 50 % veut dire que les deux sont indiscernables.

  En faire des conditions demanderait une nouvelle ADR (question 2).

### Où le résultat est rangé et lu
- **Nouvelles tables** (migration attribuée par Bilan), toutes en RLS par créatrice :
  - `blind_test_sessions` : créatrice, voix et persona figées à l'ouverture, graine, état, raison d'abandon, dates. États : `preparing` (l'agent rejoue les situations), `open` (cartes prêtes, de 0 à 100 jugées), `done` (toutes jugées), `abandoned` avec sa raison (`version_changed` ou `cancelled`). « Prête à juger » est une séance `open` sans verdict, pas un état de plus ;
  - `blind_test_cards` : situation, auteur réel, référence du message humain ou de l'appel `llm_calls`, ordre, verdict, devinette.
- **À la fin de la séance**, le serveur calcule le taux et écrit la ligne `blind_tests` comme aujourd'hui. Le `POST` existant prend alors `sessionId` au lieu de `rate`, et le taux n'est plus saisi à la main. Le propriétaire valide sous une connexion de moins de 10 minutes.
- **Le Dashboard et le verrou** lisent `blind_tests` sans changement. Le détail (cartes, taux humain, devinettes) se lit dans Entraîner › Test à l'aveugle, avec les cartes « jamais » listées. Une carte contient du vrai texte de fan : elle ne devient jamais un cas de test dans `evals/`, qui est dans le dépôt (ADR 0010).
- **Une séance périme** si la voix ou la persona change avant la fin : elle passe `abandoned` (`version_changed`), puisque son résultat ne vaudrait plus pour la version active (ADR 0022). Aucun événement n'annonce une activation de persona (recette 28/10, lot persona : l'activation est tracée par `audit_log` `persona_version.activate` et `persona_versions.activated_at`) : la séance compare la persona qu'elle a figée à l'ouverture à la version active chaque fois qu'elle la lit (verdict, fin, affichage) et passe `abandoned` dès qu'elles diffèrent. Si un événement devient nécessaire, cette fiche l'ajoute avec sa migration (`domain_events.type`).
- **Le propriétaire peut l'abandonner** pendant la préparation ou en cours : elle passe `abandoned` (`cancelled`). Une séance abandonnée ne s'enregistre jamais ; ses verdicts restent lisibles par le propriétaire seul.
- **Rétention** : quand la purge d'un fan efface ses messages ou ses faits (`docs/conventions/security.md`), les références de ses cartes (message, appel `llm_calls`) passent à NULL et leur texte est effacé. Le taux enregistré dans `blind_tests` reste.
- **Rien dans l'outbox** : aucun événement de séance ne porte le texte d'une carte. Un éventuel avis Telegram « test enregistré » ne porte que le taux et la version.
- Le minimum de 40, le taux calculé par le serveur et le `POST { sessionId }` sont décidés par l'**ADR 0034** (proposée).

## Ce que ça demande
- **Agent (playground)** :
  - le tirage des situations dans `conversations` et `messages`, par une lecture fournie par Bilan ;
  - le rejeu de l'agent sur chaque situation avec la version active et le fan reconstruit à la date de la situation (règle pure, testée) ;
  - le masquage, le mélange avec la graine et le calcul des taux, sous forme de règles pures avec leurs tests ;
  - les routes `/v1/blind-tests`.
- **Bilan** : la migration des deux tables, le `POST` de `blind_tests` qui lit une séance, la lecture des situations avec réponse humaine sans brouillon et de l'état du fan à une date (add-only dans `conversations` et `fans`), et les contrats.
- **Suivi** : rien à changer pour juger. Un tag « tiré pour un test à l'aveugle » n'est pas nécessaire, puisque le tirage ne modifie rien.
- **Extension (écran)** : Entraîner › Test à l'aveugle.
  - Avant : combien de situations sont disponibles, le coût estimé en appels IA, le bouton « Commencer » (propriétaire).
  - Pendant : une carte plein écran, avec le contexte en bulles du fan et la réponse en bulle de la créatrice, les trois boutons, la devinette, et la progression « 23 / 100 ». Ni le taux ni l'auteur ne s'affichent pendant la séance.
  - Après : les trois taux, les cartes « jamais », puis « Enregistrer le test » (connexion récente).
  - Écran Nuit et Jour, 1 440 et 400 px, état « Le serveur ne répond pas ».
- **Coût IA** : environ 50 rejeux (brain et voix), plus 10 % pour les remplacements, de l'ordre de 1 à 2 € sur le budget du jour (grok-4.7). L'écran l'annonce avant de commencer.

## Estimation
- 3 PR, à peu près 2 à 3 sessions :
  - Bilan : migration, contrats et lecture des situations (une demi-session) ;
  - Agent : tirage, rejeu, règles, routes et tests (une session) ;
  - Extension : l'écran (une session).
- Séance avec Messa : environ 1 h 30 pour 100 cartes, à raison de 45 s à 1 min par carte. Elle peut se faire en deux fois.

## Critères d'acceptation
- Aucun taux ne peut être enregistré sans une séance terminée d'au moins 40 situations, pour la version active de la voix et de la persona.
- Pendant la séance, aucun champ de l'API ni de l'écran ne permet de savoir l'auteur d'une carte (test de contrat sur le DTO de carte : ni `author`, ni identifiant de message, ni d'appel).
- Le même tirage, rejoué avec la même graine, donne les mêmes situations dans le même ordre.
- Un changement de voix ou de persona en cours de séance la rend `abandoned` (`version_changed`) ; un abandon du propriétaire la rend `abandoned` (`cancelled`).
- Une situation jugée dans une séance des 30 derniers jours n'entre pas dans un nouveau tirage.
- Une réponse humaine dont une bulle porte un `draft_id`, retouchée ou non, n'entre jamais dans un tirage (test d'intégration avec un brouillon `edited` envoyé).
- Une réponse humaine avec un média, un PPV ou une étape de script n'entre jamais dans un tirage.
- Le rejeu d'une situation à la date t ne voit aucun fait observé, aucune limite, aucune note de désir ni aucun message postérieurs à t (test avec un fait appris après t).
- Le prénom du fan n'apparaît ni dans le contexte ni dans aucune des deux réponses d'une carte.
- Une carte dont le fan est purgé garde sa ligne sans texte ni référence, et le taux de `blind_tests` ne change pas.
- Aucune vraie donnée de fan dans le dépôt : les tests utilisent des conversations inventées (ADR 0010).
- Rien n'est envoyé à un fan pendant toute la séance.

## Questions pour Charles (défauts pris en attendant)
1. Exception à l'ADR 0023 : Messa voit des extraits de vraies conversations, noms masqués, sur ta session et à ton écran, sans aucun droit nouveau pour son compte. Défaut : oui. Si c'est non, le test se fait sur des conversations inventées.
2. Le taux de « jamais » et l'indiscernabilité restent des informations, sans devenir des conditions. En faire des conditions demanderait une nouvelle ADR. Défaut : informations seulement.
3. 50 situations (100 cartes) et un minimum de 40. Défaut : 50 et 40.

## Hors périmètre
L'ouverture de l'Automatique elle-même (déjà dans le verrou), la transformation d'une carte en cas d'éval (vrai texte de fan), les vocaux, les médias et les étapes de script dans le test, une autre créatrice que Messa.

## Notes de session
