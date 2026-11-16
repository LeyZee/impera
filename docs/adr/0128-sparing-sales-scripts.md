# 0128. Ménager les scripts : une pause après un achat, un script rejoué par une autre variante du teasing, l'IA qui réclame des scripts

Statut : accepted (« ok 0128 » de Charles le 16/11/2026 à 13 h 16, avec « ok recommandations » pour les quatre questions ; variante attachée à l'étape, 16/11 à 12 h 18 ; fil « Économiser les scripts de vente » ; relu par Médias, Bilan et le fil Mesurer)
Date : 2026-11-16
Précise : l'ADR 0098 (§ 1 un script ne se rejoue jamais, § 6 média déjà reçu, § 9 pack refusé, § 12 même session), l'ADR 0112 (§ 5 conditions de branche, § 11 média déjà reçu, § 15 « un script ne se rejoue pas »), l'ADR 0103 (porte), l'ADR 0056 (variantes A, B, C d'une étape, cadence de demande des scripts), la politique d'offre (`agent/domain/policy.ts`). Ne remplace aucun ADR en entier.

## Contexte

Le 16/11/2026, Charles constate que l'agent, dont le but est de vendre, va **consommer ses scripts trop vite**. Un script est tourné par la créatrice, en nombre fini. Trois choses le consomment aujourd'hui :

1. **Le rythme.** Après un achat, rien n'empêche l'agent de rouvrir un script dès la fin du délai entre deux scripts (`script_launch.cooldown_hours`, de 0 à 24 h, compté depuis la dernière offre, ADR 0098 § 17). Un outil payé au pourcentage a intérêt à vendre vite ; l'agence, qui paie l'agent elle-même, préfère la relation : un fan qui vient de payer et qu'on relance le lendemain se sent client, pas désiré.
2. **Le script « brûlé ».** Un script ne se rejoue jamais au même fan (ADR 0098 § 1), et un script dont un média lui a été envoyé sort de sa liste (ADR 0098 § 6, ADR 0112 § 11). Un fan qui reçoit le teasing offert puis n'achète pas la première étape payante a donc **brûlé** ce script sans rien payer : il ne pourra plus jamais le lui vendre.
3. **Le stock.** Personne ne voit venir le moment où les bons acheteurs n'ont plus de script neuf devant eux. La cadence (ADR 0056 § 2, `scripts.ask_scripts`) demande un script tous les N jours, sans regarder ce qui reste.

Ce qui existe déjà et sert : les **variantes** A, B et C d'une étape dans l'atelier des structures (ADR 0056 : « jusqu'à trois variantes qui partagent la même étape », cartons « Série A, B, C », ADR 0064), que la créatrice tourne déjà pour le teasing ; les **branches** d'une étape et leurs conditions évaluées par le code (ADR 0112) ; la **file de structures** et la **demande de script** à la créatrice (`content_requests`, origine `cadence`) ; le signal `fanAsksForPaid` qui lève déjà le délai entre deux scripts.

## Décision

### A. Une pause après un achat

1. **Après un achat dans un script, l'agent n'ouvre plus de script de lui-même pendant la pause après achat** (`script_launch.after_purchase_hours`, dans la persona, réglable par créatrice dans le CRM, de 24 à 72 h, 48 h par défaut). Elle court depuis le **dernier achat** d'une étape payante d'un déroulé (`sale_detected` relié au pack, ADR 0098 § 8). Elle s'ajoute au délai entre deux scripts, qui ne change pas : un script ne part que quand les deux sont écoulés.
   - Elle ne touche pas le déroulé en cours : l'escalier de la même session, l'aftercare et le pont qui suivent un achat partent comme aujourd'hui (ADR 0098 § 8, ADR 0112 § 9). La pause commence quand ce déroulé est fini.
   - Un pourboire ou une commande sur mesure n'est pas un achat de script : ils ne l'ouvrent pas.

2. **Pendant la pause, elle fait de la relation.** L'agent n'ouvre pas la sexualisation de lui-même (comme avant `sexualization.initiate_after_hours`) et ne démarre aucun script (`offerDecision` rend `after_purchase`). La voix parle de lui, d'elle, de la suite de ce qu'il a acheté, sans rien proposer. Aucune règle de relation n'entre dans un prompt : la voix reçoit seulement la décision `none`.

3. **Ce qui lève la pause, pour la session en cours seulement** : **il sexualise de lui-même** (`fanSexualizes`, au sens de la porte de l'ADR 0103, pas un simple flirt) ou **il demande du contenu** (`fanAsksForPaid`). Elle le suit alors ; un script ne part encore que si la porte de l'ADR 0103 est ouverte et que sa note de désir atteint le seuil (`script_launch.min_desire`). À la session suivante, la pause reprend si elle n'est pas écoulée.

4. **À la fin de la pause, elle ne repart d'elle-même que si sa note de désir le permet**, comme aujourd'hui : rien ne force une vente le jour où la pause tombe.

5. **Où ça vit** : `offerDecision` reçoit `lastPurchaseAt` (lu dans le journal, `sale_detected` d'un pack de script) et `limits.afterPurchaseHours` ; le motif nouveau `after_purchase` se place après `no_budget` et avant `cooldown`, et tombe avec `fanAsksForPaid` ou `fanSexualizes`. Testé en unitaire, sans base.

### B. Rejouer un script par une autre variante du teasing

6. **Un script peut se rejouer au même fan tant qu'il n'y a rien acheté** (précise ADR 0098 § 1 et ADR 0112 § 15). Dès qu'une étape payante de ce script est achetée par ce fan, le script est fini pour lui, pour toujours, comme aujourd'hui.

7. **Ce qui permet le rejeu** : le premier déroulé s'est fermé sur `stalled` (sans réponse), `no_branch`, sur un refus **par silence** (étape payante ignorée deux messages, ADR 0098 § 9) ou sur la fin de session (ADR 0098 § 12), sans achat. **Ce qui l'interdit** : un refus dit (« non », « pas intéressé »), un manque d'argent avoué (`no_budget`, gel `money_trouble`), une reprise par un humain (`closed_by_human`), un risque. Refus dit : pas de rejeu (Charles, 16/11/2026).

8. **Le teasing rejoué est une autre variante, jamais le même média.** La variante de teasing est une **branche** de la première étape (ADR 0112 § A), avec ses propres médias : selfie, miroir, autre pièce, autre cadrage, choisis à la tournée (séries A, B, C de l'atelier, ADR 0056). Une condition structurée nouvelle, **`unseen_variant`** (évaluée par le code seul, ADR 0112 § 5), dit « une branche dont il n'a reçu aucun média ». Au premier passage, c'est la branche par défaut qui part ; au rejeu, la première variante qu'il n'a jamais reçue, dans l'ordre fixé par l'agence.
   - **Des séries de l'atelier aux branches de Reveal.** Les séries A, B, C vivent dans la structure (scripts demandés par Impera) ; le rejeu tourne sur les scripts natifs de Reveal par leurs branches. Le lien se fait quand l'équipe recopie le script dans Reveal (SC-03) : les séries du teasing y deviennent des branches au même rang que la première étape, dans l'ordre A, B, C. Reveal ne porte aucune lettre : « variante B » se lit par cet ordre de branches. Le guide de copie (fil Médias) le dit.
   - **L'étape de teasing**, pour le code : la première étape de la structure dont l'accès est offert (`access` gratuit). À ne pas confondre avec la photo d'accroche d'un pont. **Plus de variante neuve : plus de rejeu.** Un script a donc au plus autant de passages par fan que de variantes de teasing (trois avec l'atelier).

8 bis. **Créer une variante dans l'éditeur** (ADR 0112 § 17 ; Charles, 16/11/2026 à 12 h 18 : la variante reste attachée à l'étape, dans le même script, pas de copie du script). Sur la carte de l'étape de teasing, un bouton **« Ajouter une variante »** ouvre une branche nouvelle de cette étape, pré-remplie de la variante d'origine (texte, consigne, rythme), avec la condition `unseen_variant` déjà posée ; on n'y change que ses **médias** (choisis dans le coffre) et son **texte**, que `script_writer` peut proposer à partir de ses médias. Tout le reste du script (étapes payantes, prix, ponts, messages après le média) est **partagé**, jamais copié. Dans la carte, les variantes sont côte à côte comme des branches (onglets au téléphone), nommées A, B, C dans l'ordre. Chez Reveal, la variante devient une branche au même rang que la première étape (un script de l'API de plus dans la même séquence, ADR 0112 § 1).
   - **Pourquoi pas une copie du script** : une copie dédouble les prix et les textes à tenir à jour, coupe la mesure en deux, et ferait perdre au code la règle « il a déjà acheté dans ce script » (§ 6) puisque ce serait un autre script.
   - Le bandeau « ce qui manque » (ADR 0112 § 13) nomme une variante sans médias ou sans descriptions validées ; une variante qui reprend un média d'une autre variante est refusée à l'activation (même média deux fois sur l'étape).

9. **« Média reçu jamais renvoyé » reste vrai** (ADR 0098 § 6, ADR 0112 § 11), avec une précision : une étape payante **envoyée et non achetée** ne lui a pas donné ses médias vendus, seulement son **aperçu**. Le calcul du média reçu compte donc, pour une étape payante non achetée, son aperçu et pas ses médias vendus. Conséquences :
   - l'étape payante rejouée peut repartir, avec ses mêmes médias vendus et son même prix (jamais moins cher : ni prix réduit, ni branche « moins cher », ADR 0112 § 8) ;
   - son **aperçu** compte comme reçu : l'étape payante ne se rejoue que si elle a une branche à un autre aperçu. Un aperçu entièrement flouté ne suffira que si la capture du § 13 montre que Reveal expose ce flou dans ce qu'on lit ; sans cette donnée, la règle reste « une branche à un autre aperçu ». Un script dont l'étape payante ne peut pas repartir ne se rejoue pas.
   - Cette vérification ne passe **jamais par `gaps`**, qui décide `proposable` et bloquerait aussi le premier passage : la vue du script porte un drapeau séparé **`replayable`**, avec sa raison quand il est faux.

10. **Délai avant de rejouer le même script** au même fan : `script_launch.replay_after_days`, dans la persona, réglable par créatrice, de 7 à 60 jours, 14 par défaut. Quand un script **jamais envoyé** à ce fan est jouable, il passe avant un rejeu : le rejeu ne sert qu'à ne pas laisser un fan chaud sans rien.

11. **Le pack refusé n'est pas reproposé dans la même session** : le rejeu est un nouveau déroulé (`script_run` nouveau, avec un numéro de passage `attempt`), soumis à tout ce qui ouvre un script : porte de l'ADR 0103, politique d'offre, délai entre deux scripts, pause après achat. Au plus un déroulé ouvert par fan (ADR 0098 § 1).

12. **La clé d'idempotence d'envoi devient par conversation, script, passage et étape** (`attempt` en plus) : un rejeu n'est jamais confondu avec un renvoi du premier passage, et un job rejoué n'envoie toujours rien deux fois. **Reveal reste la vérité** sur ce qui est parti et acheté (ADR 0098 § 2) ; le passage, le refus et sa sorte (dit ou par silence) n'appartiennent qu'au déroulé.

13. **À vérifier sur le compte fan « test » avant le premier rejeu réel** (fil Bilan, capture) : que Reveal accepte d'envoyer une deuxième fois la même étape payante (même `stepRef`) au même fan, et comment elle s'affiche des deux côtés. Si Reveal le refuse, le rejeu attend un ADR qui dise comment (étape payante doublée chez Reveal sous un autre `stepRef`, même médias, même prix) ; le reste de cet ADR ne change pas. Tant que ce n'est pas vérifié, `unseen_variant` et le rejeu ne tournent qu'au playground et dans les évals.

14. **Ce que montre le CRM** : dans la conversation et « Pourquoi » au playground, « Rejeu, passage 2, variante B » ; dans la mesure des scripts (ADR 0129, qui précise ADR 0112 § 19), le taux d'achat par passage et par variante, pour savoir si le rejeu vend. Le passage (`attempt`) est tenu par le déroulé (`script_runs`, § 11) et recopié sur chaque envoi d'étape de la table `script_step_sends` de l'ADR 0129, avec la branche (variante) partie : la mesure n'est qu'une comparaison de ces lignes.

### C. L'IA réclame des scripts quand le stock baisse

15. **Le stock se mesure par fan, pas au total.** Il se lit dans les envois d'étape de l'ADR 0129 (`script_step_sends`), réconciliés avec l'historique de Reveal, qui reste la vérité sur ce qui est acheté (ADR 0098 § 2). Pour chaque **acheteur actif** de la créatrice (au moins un achat de script dans les 30 derniers jours), le code compte les scripts **encore jouables pour lui** : jamais achetés par lui, du bon moment possible, proposables (ADR 0112 § 13), plus ceux qu'il peut encore se voir rejouer (§ 8). Un acheteur actif est **à court** quand il lui en reste moins que le **plancher de stock** (`script_cadences.stock_floor`, réglable par le propriétaire, 2 par défaut).

16. **Quand trop d'acheteurs actifs sont à court**, au-delà d'une **part** réglable par le propriétaire (`script_cadences.stock_share`, 25 % par défaut), le job de la cadence **avance la prochaine demande de script** : il prend la structure suivante de sa file, la fige et la demande comme le fait déjà la cadence (`content_requests`, origine nouvelle `stock`). Elle la voit là où arrivent déjà ses demandes de script, avec ses cartons.
   - **Aucune demande `stock` ne part tant qu'une demande de script est ouverte et pas encore déposée**, qu'elle vienne de la cadence ou du stock : elle n'en reçoit jamais deux à la fois.
   - Elle suit l'**alternance Jour / Nuit** déjà décidée pour les demandes de script (`content_requests.moment`, « ok alternance »).
   - La demande de stock remet le compteur de la cadence à zéro : on ne double pas la demande du calendrier.
   - **File vide** : rien n'est demandé, l'agence est prévenue en ambre (« Stock de scripts bas, file de structures vide ») ; le propriétaire choisit une structure.

17. **L'agence est prévenue** : la demande `stock` entre dans « À traiter » avec le nombre d'acheteurs actifs à court (jamais leurs noms dans la notification), et l'écran de la cadence montre le stock du jour (`stock_short`, `stock_active`).

18. **Les variantes se demandent avec le script.** Une structure dont l'étape de teasing (§ 8) a moins de deux variantes porte un **avertissement** à l'enregistrement (par `saveDecision`, jamais une faute) (« une seule variante de teasing : ce script ne pourra pas se rejouer »), jamais un refus. La file ne demande pas de variante seule pour un script déjà tourné : un script importé de Reveal reçoit ses variantes comme branches de sa première étape, ajoutées par l'agence (ADR 0112 § 1).

### D. Qui code quoi

| Fil | Ce qu'il code |
|---|---|
| **Bilan** | La migration : `after_purchase_hours` et `replay_after_days` dans le schéma de persona (contrat), `attempt` et la sorte du refus (`said` / `silence`) dans `script_runs`, la clé d'idempotence par passage, `stock_floor`, `stock_share` et les deux compteurs dans `script_cadences`, l'origine `stock` dans `content_requests`, `unseen_variant` dans les conditions de branche du contrat. La capture du § 13 sur « test ». |
| **Agent** | `offerDecision` (§ 5), le rejeu dans `script-run.ts` (§§ 6–12) : liste permise, choix de la branche `unseen_variant`, média reçu d'une étape non achetée, priorité aux scripts neufs ; le calcul du stock par fan, exposé par son `index.ts` (lecture seule) ; les évals : pause après achat, pause levée parce qu'il sexualise, rejeu par la variante B, pas de rejeu après un refus dit ni après un achat. |
| **Médias** | Le job de la cadence (§ 16) qui lit le stock par l'`index.ts` d'Agent, l'origine `stock`, l'avertissement de variante (§ 18), le drapeau `replayable` (§ 9, hors de `gaps`), le guide de copie des séries en branches (§ 8). |
| **Design** | Les réglages : pause après achat et délai de rejeu dans Créatrices › persona (stratégies) ; plancher et part du stock dans l'écran de la cadence ; la ligne ambre « file vide » ; « Rejeu, passage n, variante X » dans « Pourquoi » et la conversation. |

Ordre : **d'abord l'évaluation des conditions de branche de l'ADR 0112** (aujourd'hui un script à branches n'est jamais proposable, `branched_step`, depuis #781) : le rejeu par variante en dépend. Puis Bilan (migration et contrat), puis Agent et Médias en parallèle, puis Design. La pause après achat (§ A) ne dépend de rien de cela et peut passer en premier. Une PR à la fois par fil.

## Conséquences

Positives :
- Moins de scripts consommés par des fans qui n'ont rien payé ; un fan qui a payé n'est pas relancé dès le lendemain.
- La créatrice tourne au rythme de ce qui manque vraiment, pas seulement du calendrier.
- Tout est décidé par le code et se relit (« Pourquoi », mesure par passage et variante).

Négatives :
- Une étape de teasing demande au moins deux variantes tournées pour qu'un script se rejoue.
- Le rejeu dépend d'une vérification chez Reveal (§ 13) ; avant elle, il ne tourne qu'au playground.
- Le fan qui a vu le premier passage peut reconnaître l'étape payante (même texte d'offre, même aperçu flouté) : c'est le prix de l'économie, mesuré par le taux d'achat par passage (§ 14).
- Une migration (Bilan) et un calcul de stock par fan, refait par le job horaire de la cadence.

## Alternatives rejetées

- **Prix réduit au rejeu** : une remise déguisée ; jamais (ADR 0112).
- **Rejouer le même teasing** : il le reconnaîtrait, et « média reçu jamais renvoyé » tomberait.
- **Mesurer le stock au total** (scripts jamais envoyés à personne) : un acheteur qui a tout vu reste sans rien alors que le total paraît plein.
- **Une tâche « Tourner un script » dans son agenda, à côté de la demande de script** : deux chemins pour la même chose ; la demande de script porte déjà la structure, les cartons et le dépôt.
- **Une pause qui bloque aussi quand il sexualise** : on refuserait une vente qu'il demande.

## Décisions de Charles (16/11/2026, 13 h 16, « ok recommandations »)

1. Pause après achat : 48 h par défaut, réglable de 24 h à 3 jours par créatrice ; levée pour la session s'il sexualise de lui-même ou demande du contenu (§§ 1–3).
2. Pas de rejeu après un refus dit (« non » net) ; rejeu seulement après un silence, un `stalled`, un `no_branch` ou une fin de session (§ 7).
3. Délai avant de rejouer le même script : 14 jours par défaut, réglable de 7 à 60 (§ 10).
4. Stock : la demande de script est avancée quand plus d'un quart des acheteurs actifs ont moins de deux scripts jouables, réglable par le propriétaire (§§ 15–16).
