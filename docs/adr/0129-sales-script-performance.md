# 0129. Mesurer les scripts de vente : l'entonnoir par étape, le revenu par fan exposé, ce qui casse et pourquoi

Statut : accepted (Charles, 16/11/2026 12h31 UTC, « ok 0129 », fil « Mesurer l'efficacité des scripts » ; réponses aux trois questions le 16/11 à 12h31 : « fais ce que tu me recommandes »)
Date : 2026-11-16
Précise : l'ADR 0112 § 19 (« Mesure : par script, étape et branche, taux d'ouverture, taux d'achat et revenu »), l'ADR 0098 §§ 2 et 16 (le journal du déroulé sert à mesurer), l'ADR 0128 § 14 (achat par passage et par variante), l'ADR 0103 (note de désir 0–100). Ne remplace aucun ADR.

## Contexte

Le 16/11/2026, Charles demande de quoi décider sa stratégie de scripts : quel script vend le mieux, combien de fans passent chaque étape, et surtout **pourquoi** un script vend ou ne vend pas (le texte de vente, le média, le prix). Il veut un écran poussé mais sans information inutile, au niveau de finition du Dashboard : belles animations, beaux survols, hiérarchie claire, compréhensible d'un coup d'œil.

L'ADR 0112 § 19 annonçait la mesure en une ligne. Cet ADR dit ce qui se mesure vraiment, d'où vient chaque chiffre, et ce qui ne se mesure pas.

**Ce qu'Impera sait déjà, relu dans le code le 16/11/2026 :**

| Donnée | Où | Couvre |
|---|---|---|
| Chaque étape envoyée, ouverte, achetée ou refusée, avec l'heure et le prix de la décision | `script_runs.steps` et les événements `script_started`, `script_step_sent`, `script_step_opened`, `script_step_refused`, `script_ended` (ADR 0098) | Les déroulés de l'agent seulement |
| La note de désir du fan au fil de la conversation | événements `desire_scored` (ADR 0103) | Les conversations que l'agent suit |
| Les messages du fan avant et après une étape | `messages` (sens, auteur, heure) | Tout le monde |
| Par étape de Reveal, depuis toujours : envois, packs payés, montant payé | `GET /scripts/model/:id` sans conversation : `sentCount`, `paidBundlesCount`, `paidBundlesTotalAmount` (lu par `wire.ts`, **jamais stocké**) | Tout le monde, agent et chatteurs mêlés, sans date ni fan |
| Jusqu'où le fan a lu la conversation | `memberLastReadAt` de la liste des messages (lu par `wire.ts`, **jamais stocké**) | Tout le monde |
| Le texte, le prix et les médias d'une étape | `platform_script_steps`, `platform_script_step_media` (réécrits quand l'étape change, sans historique) | Tout le monde |
| Les ventes du registre | `platform_sales` | Tout le monde, **sans lien vers le pack ni le script** |

**Ce que Reveal ne dit pas** : si le fan a ouvert l'aperçu ou le média (seulement s'il a lu le message), ni quel chatteur a envoyé une étape, ni l'heure d'un envoi dans ses totaux par étape.

## Décision

### A. Ce qu'on mesure, et rien d'autre

1. **Le fan exposé est l'unité.** Un fan exposé à un script est un fan qui en a reçu la première étape. Tous les taux se rapportent aux fans, jamais aux messages : un fan qui reçoit deux fois la même étape (rejeu, ADR 0128) compte une fois par passage, et le passage est affiché.

2. **L'entonnoir par étape.** Pour chaque étape (et chaque branche, ADR 0112), sur les fans arrivés jusqu'à elle :
   - **envoyée** : combien l'ont reçue ;
   - **lue** : combien ont lu le message de l'étape (`memberLastReadAt` postérieur à l'envoi). C'est le seul « taux d'ouverture » honnête : Reveal ne dit pas si l'aperçu a été regardé, et l'écran dit « lu », jamais « ouvert » ;
   - **achetée** (étape payante) ou **a répondu** (étape offerte : il a écrit après l'avoir reçue, avant l'étape suivante) ;
   - **perdue** : le reste, rangé en trois sortes (§ 4).
   L'étape où l'entonnoir perd le plus de fans par rapport au reste du script est **l'étape qui casse** ; elle porte l'accent visuel du script (ambre si elle perd nettement plus que ses voisines, § 8).

3. **Le revenu par fan exposé**, pas le revenu total : ce qu'un script rapporte en moyenne pour chaque fan à qui on l'ouvre (montant payé par le fan, TTC, comme Reveal l'affiche). Le revenu total s'affiche à côté, en second. C'est le chiffre qui classe les scripts : un script joué 200 fois gagne toujours plus qu'un script joué 20 fois, il n'est pas meilleur pour autant.

4. **Pourquoi un fan est perdu à une étape payante**, en trois sortes calculées par le code, chacune avec sa lecture :
   - **pas lu** : il n'a jamais lu le message. Le texte et le média n'y sont pour rien : c'est le moment (il était parti). Lecture : « Envoyée trop tard dans la session » ;
   - **lu, puis silence** : il a lu et n'a plus écrit pendant la session. L'offre entière l'a refroidi : texte d'offre, aperçu et prix ensemble. Lecture : « L'offre fait fuir » ;
   - **lu, il répond, mais n'achète pas** : il reste dans la conversation et refuse ou esquive. Il est intéressé mais pas convaincu : l'aperçu ou le prix. Lecture : « Il reste, mais n'achète pas ».
   Pour une étape offerte (teasing, pont), la perte se lit pareil : **pas lu** ou **lu, sans réponse** (le teasing n'accroche pas).

5. **Séparer le texte, le média et le prix : seulement en comparant.** Les trois sortes du § 4 disent où regarder, pas laquelle des trois causes est la bonne : un fan qui lit et n'achète pas a vu le texte, l'aperçu et le prix d'un coup. On ne le sépare honnêtement qu'en **changeant une seule chose** et en comparant :
   - **deux branches ou deux variantes de teasing** d'une même étape (ADR 0112, ADR 0128 § 8) qui diffèrent par leur média : l'écran les met côte à côte ;
   - **avant / après une modification** d'une étape (texte, prix ou médias changés dans Reveal) : chaque modification ouvre une **version** de l'étape (§ 10), et l'écran compare la version d'avant et celle d'après, en nommant ce qui a changé (« Prix changé », « Texte changé », « Aperçu changé »).
   L'écran ne donne jamais une cause qu'il n'a pas mesurée : sans comparaison possible, il s'arrête au § 4.

6. **Le niveau de désir au lancement** (déroulés de l'agent) : la note de désir du fan au moment où le script s'est ouvert, en trois tranches (sous le seuil haut de l'ADR 0103, autour, au-dessus), avec le taux d'achat de la première étape payante dans chaque tranche. Sert à régler `script_launch.min_desire` créatrice par créatrice.

7. **Ce qui se passe après** (sur 30 jours après la fin du déroulé) : part des fans qui **réécrivent dans les 7 jours**, part qui **achètent un autre script dans les 30 jours**, part qui **n'ont plus rien écrit depuis 14 jours**. Un script qui vend mais fait taire ses acheteurs coûte cher ; l'écran le met en ambre s'il fait nettement pire que les autres scripts de la créatrice (§ 8).

### B. Ne pas mentir avec peu de fans

8. **Chaque chiffre porte son nombre de fans**, et sous un **minimum** (`SCRIPT_STATS_MIN_FANS`, constante du code, 20 fans par défaut) il est remplacé par « Pas assez de données (n fans) », jamais par un pourcentage. Une différence entre deux scripts, deux branches, deux versions ou une étape et ses voisines n'est dite **nette** (et colorée) que si les intervalles de confiance à 95 % des deux taux (Wilson) ne se chevauchent pas ; sinon elle s'écrit « écart pas encore sûr ». Pas de verdict sur du bruit.

9. **Deux sources, jamais mélangées sans le dire.**
   - **Détail** (lu, perdu et ses trois sortes, désir, après, branches, versions) : les déroulés de l'agent, plus les envois de scripts des chatteurs que l'ingestion des messages reconnaît (§ 11). C'est la vue par défaut.
   - **Totaux de Reveal** (envois, packs payés, montant payé par étape, tous vendeurs) : une ligne de contrôle sous l'entonnoir, « Selon Reveal, tous vendeurs : n envois, n achats ». Si les deux divergent de plus de 10 %, une ligne ambre le dit. Reveal fait foi sur l'argent (ADR 0098 § 2).

### C. D'où viennent les données (le code à écrire)

10. **Version d'étape.** Quand l'import des scripts (`scripts.import_platform_scripts`) trouve une étape changée (texte, prix, médias vendus ou aperçu), il garde la version d'avant au lieu de l'écraser : table nouvelle `platform_script_step_versions` (étape, empreinte, texte, prix, médias, valable du … au …), sous la RLS de la créatrice et fermée à son compte. Chaque envoi se rattache à la version en vigueur à son heure.

11. **Envois, lectures, réponses, achats rattachés à une étape**, pour l'agent et pour les chatteurs. Un message envoyé portant un pack dont l'étape se retrouve par son `stepRef` dans le catalogue (`scriptId` d'un envoi, ou étape « déjà envoyée » de `GET /scripts/model/:id?conversationId=`, ADR 0098 § 14) devient un **envoi d'étape** : table nouvelle `script_step_sends` (fan, conversation, étape, branche, version, passage, vendeur `agent` ou `team`, envoyé à, lu à, acheté à, prix). L'agent l'écrit à l'envoi ; pour les chatteurs, la lecture de l'historique l'écrit. `memberLastReadAt` est enfin stocké sur la conversation pour remplir « lu à ». Idempotent par (conversation, `stepRef`, passage).

12. **Totaux de Reveal par jour.** Les compteurs par étape (`sentCount`, `paidBundlesCount`, `paidBundlesTotalAmount`) sont cumulés depuis toujours : un relevé par jour (`platform_script_step_daily`) donne la différence d'un jour à l'autre, donc des totaux par période. À vérifier sur le compte « test » avant de s'y fier : si un message de masse porté par une étape entre dans `sentCount`.

13. **Le calcul** est du domaine pur (module `scripts`) : des envois d'étape, des messages, des notes de désir et des versions entrent, un **bilan de script** sort (entonnoir, sortes de pertes, revenu par fan exposé, tranches de désir, après, comparaisons, verdict « net » ou « pas sûr »). Il lit `script_runs` et le désir par l'`index.ts` d'Agent, jamais par sa table. Les règles de lecture (§ 4), le minimum (§ 8) et l'intervalle sont dans le code, testés en unitaire. Aucun appel d'IA : pas de coût, pas de « l'IA pense que ».

### D. L'écran

14. **Où.** Dans **Créatrices › sa fiche › onglet « Scripts »**, là où l'agence règle déjà ses scripts, une section **« Performances »** en tête de l'onglet. Le Dashboard ne garde qu'une ligne ambre dans « À traiter » quand un script **décroche** (taux d'achat de sa première étape payante sur 14 jours nettement sous celui de ses 60 jours d'avant, au sens du § 8), avec un lien vers son détail.

15. **Hiérarchie, du plus utile au plus fin**, une carte par sujet :
   1. **En tête, trois chiffres** sur la période choisie (7, 30 ou 90 jours) : revenu par fan exposé, taux d'achat de la première étape payante, nombre de fans exposés ; chacun avec son évolution sur la période d'avant.
   2. **Le classement des scripts** : une ligne par script, triée par revenu par fan exposé, avec son mini-entonnoir, son étape qui casse et son nombre de fans. Les scripts sous le minimum sont en bas, grisés par leur libellé « Pas assez de données », jamais par opacité.
   3. **Le détail d'un script** (au clic) : l'entonnoir étape par étape (reprise du motif de l'entonnoir du Dashboard, `funnelSteps`), sous chaque étape ses trois sortes de pertes et la lecture du § 4 en une phrase ; puis, s'il y en a, la carte **Comparaisons** (branches, variantes, versions, § 5) ; puis la carte **Désir au lancement** ; puis la carte **Après**.
   4. **Au survol** de chaque chiffre : ce qu'il compte, sur combien de fans, et la phrase qui le lit (« 42 fans ont lu l'étape 2, 9 l'ont achetée »).

16. **Finition** (exigence de Charles, 16/11) : le niveau du Dashboard. Mêmes motifs (compteurs qui montent, entonnoir animé, infobulles flottantes, cartes), mêmes règles du projet : graphiques faits avec le skill dataviz, une carte par sujet, pas de barre colorée à gauche, aucun contrôle natif, rouge réservé aux urgences (aucune ici), ambre pour « décroche », « l'offre fait fuir » nettement au-dessus des autres, ou sources qui divergent ; Geist et Instrument Serif. Les animations respectent le mouvement réduit. Avant fusion, Charles voit les captures Nuit et Jour, PC et téléphone, **et une vidéo** des animations et des survols, après l'avis de Design.

17. **Qui le voit.** Le propriétaire et les managers actifs (lecture). Jamais la créatrice ni un chatteur : la façon dont un script est construit et vend est une méthode d'agence.

18. **Le MCP** (ADR 0105) pourra lire le bilan d'un script plus tard ; hors de cet ADR.

### E. Qui code quoi

| Fil | Ce qu'il code |
|---|---|
| **Bilan** | La migration (`platform_script_step_versions`, `script_step_sends`, `platform_script_step_daily`, `last_read_at` de la conversation ; FORCE RLS, `GRANT SELECT … TO impera_service`) ; le connecteur : `memberLastReadAt` et les totaux par étape dans le contrat, le relevé du jour, l'envoi d'étape reconnu dans l'historique des chatteurs ; la vérification du § 12 sur « test ». |
| **Agent** | L'écriture de `script_step_sends` à l'envoi d'une étape par l'agent (avec branche, passage et version) ; la lecture par son `index.ts` des déroulés et de la note de désir au lancement ; la ligne « décroche » dans « À traiter ». |
| **Médias** | Les versions d'étape dans l'import (§ 10) ; le bilan de script, domaine pur (§ 13), et sa route de lecture (authentication-sweep, origin-sweep, test d'isolation) ; les évals ne sont pas concernées (rien n'entre dans un prompt). |
| **Design** | La section « Performances » de l'onglet « Scripts » (§§ 15–16), avec le skill dataviz, les captures et la vidéo. |

Ordre : Bilan (migration, contrat, connecteur), puis Agent et Médias en parallèle, puis Design. Une PR à la fois par fil. Numéro de migration fixé au signal du coordinateur.

### F. Lien avec l'ADR 0128

19. Le passage (`attempt`) et la variante de teasing de l'ADR 0128 sont des colonnes de `script_step_sends` : le taux d'achat par passage et par variante (ADR 0128 § 14) est une comparaison du § 5, sans calcul à part. Le « stock par fan » de l'ADR 0128 § 15 lit les mêmes envois d'étape pour savoir ce qu'un fan a déjà acheté.

## Conséquences

Positives :
- Charles voit quel script rapporte le plus par fan, où chacun casse, et dans quel sens chercher (moment, offre, prix ou aperçu).
- Les chatteurs et l'agent se mesurent sur les mêmes étapes ; les totaux de Reveal contrôlent le tout.
- Aucun coût d'IA ; tout se recalcule depuis les envois d'étape.

Négatives :
- Une migration de quatre éléments et un relevé de plus par jour chez Reveal.
- Tant que peu de fans passent, l'écran dira souvent « Pas assez de données » : c'est voulu.
- Le texte, le média et le prix ne se séparent qu'en comparant des branches, des variantes ou des versions : il faut en créer pour apprendre.
- Les envois des chatteurs n'ont ni désir ni « pourquoi » de l'agent : seuls l'entonnoir, la lecture et l'après s'y appliquent.

## Alternatives rejetées

- **Revenu total comme classement** : favorise les scripts les plus joués, pas les meilleurs.
- **« Taux d'ouverture » du média** : Reveal ne le donne pas ; on n'affiche que « lu ».
- **Une IA qui explique pourquoi un script ne vend pas** : elle inventerait une cause non mesurée ; la lecture vient de règles du code.
- **L'écran sur le Dashboard** : le Dashboard sert à agir dans la journée ; il ne garde que l'alerte « décroche ».
- **Se contenter des totaux de Reveal** : sans fan ni date, ils ne disent ni où ça casse, ni pourquoi, ni ce qui se passe après.

## Décisions de Charles (16/11/2026)

1. Emplacement : section « Performances » en tête de l'onglet « Scripts » de la fiche créatrice, et l'alerte « décroche » dans « À traiter » du Dashboard (§ 14).
2. Qui voit : le propriétaire et les managers actifs, jamais la créatrice ni un chatteur (§ 17).
3. Minimum avant d'afficher un pourcentage : 20 fans (`SCRIPT_STATS_MIN_FANS`, § 8).
