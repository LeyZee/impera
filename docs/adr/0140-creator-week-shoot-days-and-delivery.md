# 0140. La semaine de la créatrice : deux jours de tournage qu'elle choisit, une livraison le dimanche, un agenda que le code remplit

Statut : accepted (Charles, 16/11/2026, 16 h 17, « ok 0140 », et ses trois choix à 16 h 19 ; cadrage de Charles, 16/11/2026, 16 h 08 : « une to-do list par semaine », « 2 jours de travail par semaine », « jusqu'à dimanche 23 h pour nous fournir le contenu », « il faut que ça soit vraiment fiable », « tout est en lien avec l'agenda »)
Date : 2026-11-16
Précise : l'ADR 0042 (§ 3 rien d'imposé, § 4 l'agenda, § 5 le topo de la semaine), l'ADR 0055 (§ 4 la demande et ses rappels, § 5 le stock), l'ADR 0056 (§ 2 la cadence des scripts), l'ADR 0126 (les lives), l'ADR 0136 (feed et stories publiés pour elle), l'ADR 0137 (les Mass DM), l'ADR 0120 et l'ADR 0082 (ce que lit Instagram, la fiche reel).

## Contexte

L'agence ne demande à une créatrice que deux jours de travail par semaine pour tourner son contenu, et elle doit le livrer à une échéance fixe. Aujourd'hui, ce qu'il lui faut tourner se décide à la main. Les demandes de contenu (ADR 0055) arrivent une par une, chacune avec sa tâche. L'agenda ne sait pas quels jours elle tourne. Et aucun job ne crée de suggestion (`creator-tasks`, `suggest.ts` n'est appelé que par l'agence et par la Veille).

Charles veut l'inverse :
- une seule semaine, préparée pour elle, qu'elle accepte d'un geste ;
- ses deux jours de tournage, choisis par elle, qui portent tout ce qu'il y a à tourner ;
- une livraison le dimanche soir ;
- des rappels pour les stories, les tournages et les lives ;
- l'agenda comme outil commun d'elle, de l'agence et de l'IA.

Il insiste sur la fiabilité. Trop de tâches tuent la to-do : la semaine doit tenir en peu de lignes.

## Décision

### 1. Ses jours de tournage

1. Dans son Agenda, elle choisit **ses jours de tournage** de la semaine (« Mes jours de tournage »). La valeur par défaut est 2, et c'est elle qui choisit lesquels.
2. Elle peut les changer d'une semaine à l'autre, jusqu'à la veille du premier. Un jour de tournage n'a pas d'heure : c'est une tâche d'un jour, jamais une tâche à heures, même si elle a ouvert une dispo ce jour-là. La dispo s'affiche à côté (ADR 0042 § 4). Ainsi, le jour de tournage ne heurte jamais ses tâches à heures.
3. Le nombre de jours demandés est un réglage d'agence par créatrice (2 par défaut). Le code ne lui en propose jamais plus.

### 2. Ce qu'il faut tourner, calculé par le code

4. Chaque semaine, le code calcule **les besoins de la semaine suivante** sur des chiffres réels, jamais par l'IA :
   - les publications du feed qui manquent pour tenir le rythme de l'ADR 0136 (au moins 3 par semaine), stock déjà déposé déduit ;
   - les stories qui manquent pour une story par jour (ADR 0136), stock déduit ;
   - les scripts dont la réserve passe sous son seuil (ADR 0055 § 5, ADR 0056 § 2), avec « Tourner le script X » (la structure demandée) ;
   - les médias de **Relance** (photos ou vidéos sexy hors séance, catégorie `mass_dm` de l'ADR 0055) que demandent les Mass DM de la semaine suivante. Leur nombre vient du plan des Mass DM (`relanceNeedFor`, ADR 0137 § 3), jamais de ce calcul. Ils se tournent vite, sur ses jours de tournage (Charles, 16/11 : « en dehors des séances, uniquement pour les Mass DM ») ;
   - les idées validées par l'agence (Veille, et les retours d'Instagram de l'ADR 0120, avec leur fiche reel de l'ADR 0082), au plus 2 par semaine.
5. **Une charge plafonnée.** Chaque sorte de besoin a une durée de tournage estimée, et chaque jour de tournage a une capacité. Ces deux valeurs sont des réglages d'agence, avec des valeurs par défaut dans le code. Si les besoins dépassent ce que tiennent ses jours de tournage, le code garde d'abord ce qui bloque une vente : un script dont la réserve est vide, puis le feed, puis les médias de Relance, puis les idées, puis les stories. Le reste passe à la semaine d'après, et l'agence le voit. Jamais une semaine plus lourde que ses jours.
6. Les dégoûts et les limites de sa persona sont filtrés par le code avant toute proposition (règle 3 de `CLAUDE.md`). La règle « jamais de nu » vaut pour toutes les sorties publiques (ADR 0055 § 1).

### 3. Peu de lignes dans sa semaine

7. Toute la semaine tient en quelques tâches :
   - **une tâche par jour de tournage** (« Jour de tournage »), qui porte la liste de ce qu'il y a à tourner ce jour-là, chaque élément avec sa fiche de tournage (ADR 0042 § 4), coché un par un ;
   - **une tâche « Livrer ma semaine »**, avec l'action « Déposer », qui regroupe les demandes de contenu de la semaine (ADR 0055 § 4) ;
   - les lives prévus, s'il y en a (§ 6).
8. Pas de tâche par demande, pas de tâche avant ni après un live, pas de rappel par élément. Les demandes restent des `content_request` pour le stock et la mesure, mais elles s'affichent dans la tâche de livraison.

### 4. L'échéance de livraison

9. La livraison est due **le dimanche à 23 h, dans son fuseau** (`creators.timezone`, où se calculent aussi l'échéance et le rappel du matin ; ses écrans les montrent à l'heure de son téléphone), pour toutes les créatrices. Le jour et l'heure restent un réglage d'agence par créatrice (Charles, 16/11 : « on peut le changer »).
10. Les rappels respectent ses heures calmes et son plafond du jour (ADR 0042 § 7) :
    - le matin de chaque jour de tournage, à 9 h par défaut, un rappel : « Aujourd'hui, jour de tournage : 2 séances, 1 script ». Il ne sonne pas si la tâche a été déplacée, faite ou retirée ;
    - la veille de l'échéance et le jour même, s'il manque encore des dépôts (ADR 0055 § 4) ;
    - puis plus rien.
11. Après l'échéance, ce qui manque reste ouvert chez elle. Côté agence, ça passe en ambre : « Livraison en retard : 1 script, 2 stories ». Le code ne sanctionne rien et ne dit rien aux fans.

### 5. Proposée, jamais imposée

12. La semaine arrive avec le topo du dimanche (ADR 0042 § 5), comme **un bloc de suggestions**. Elle l'accepte d'un geste (« Accepter ma semaine ») ou tâche par tâche. Elle peut déplacer ou refuser sans se justifier. Une tâche refusée n'est pas reproposée la même semaine ni la suivante (règle existante).
13. L'agence relit la semaine avant son départ, dans l'écran du topo. La règle de l'ADR 0042 § 5 s'applique : départ à la validation, ou le lundi à 8 h si personne n'y a touché, ou validation obligatoire si le réglage est mis. **La validation est obligatoire** : le propriétaire relit, corrige si besoin, et valide chaque semaine avant qu'elle parte chez la créatrice (Charles, 16/11 : « ça me propose les trucs, je valide, je corrige »). Une semaine non validée ne part pas le lundi à 8 h. Le propriétaire est prévenu le dimanche soir qu'une semaine attend.
14. **Le code décide, l'IA rédige.** Les besoins, les quantités, les jours et l'échéance viennent du code. Le modèle de langage ne rédige que le texte du topo et des fiches de tournage, à partir des seuls faits reçus (ADR 0042 § 5). Sans IA, par exemple avec un budget épuisé ou sans clé, la semaine part quand même, avec des fiches écrites par le code à partir de la catégorie et de la structure demandée.

### 6. Lives et stories

15. **Lives.** Rien d'automatique : le code ne propose aucun live. C'est la créatrice qui planifie les siens dans son agenda, et qui choisit la plateforme (ADR 0126 §§ 1-2). Ses lives prévus apparaissent dans sa semaine, et le silence de l'agent pendant le live suit l'ADR 0126.
16. **Stories.** Elles se tournent en lot pendant ses jours de tournage, puis l'ADR 0136 les publie pour elle, une par jour. Un rappel « Pense à ta story » ne part que les jours où le stock de stories est vide, une fois, sous ses heures calmes.

### 7. Un agenda commun

17. **Un seul agenda**, vu par trois parties :
    - elle, dans Agenda ;
    - le propriétaire et le manager actif, dans Créatrices › Agenda (ADR 0042 § 3) ;
    - l'agent, qui n'en lit que ce qui est **fait** (bloc `<her_day>`, ADR 0126 § 9).
18. Ce qui part pour elle (publications du feed, stories, Mass DM des ADR 0136 et 0137) apparaît dans son agenda en lecture seule (« Publié pour toi à 20 h »), pour qu'elle sache ce qui sort sous son nom. Elle garde son droit de retrait (ADR 0042 § 2).

### 8. Fiable et mesuré

19. Le job de la semaine est **rejouable** : une semaine par créatrice, avec une clé d'idempotence. Rejoué, il ne double jamais une tâche. Une semaine qui ne peut pas se calculer (stock illisible, connecteur en panne) ne propose rien et prévient le propriétaire. Elle n'invente jamais un besoin.
20. Les règles du calcul (besoins, plafond, ordre, échéance) sont pures et testées en unitaire, sur des semaines inventées.
21. Mesures pour le propriétaire, dans Créatrices › Agenda :
    - le **taux d'acceptation** des semaines et des tâches ;
    - le **taux de livraison à l'heure** ;
    - le **stock en jours** par catégorie.
    Rien de cela n'est montré à la créatrice comme une note.

### 9. Comment c'est rangé dans le code (relu par Équipe)

22. **Qui calcule, qui écrit.** Le calcul de la semaine (stock, scripts, persona, idées) vit hors de `creator-tasks`. Il écrit dans l'agenda par un port de son `index.ts` (`suggestWeek`, comme `suggestShoot`). `creator-tasks` ne lit ni stock, ni scripts, ni persona. L'identifiant de chaque suggestion se tire de (créatrice, semaine, besoin) : un job rejoué ne double rien.
23. **La règle des refus.** Une tâche refusée n'est pas reproposée la même semaine ni la suivante (même catégorie, même titre). Cette règle ne doit pas bloquer le « Jour de tournage » de la semaine d'après : la clé du refus porte la semaine visée, ou le titre porte le jour.
24. **La liste à cocher** d'un « Jour de tournage » est une table d'éléments liés au couple (tâche, créatrice). L'agence ou le job écrivent le texte et la fiche. Elle ne coche que l'état (`GRANT UPDATE` limité à cette colonne), dans la fenêtre de 48 h des coches (ADR 0042 § 8). La tâche est faite quand tous ses éléments le sont.
25. **« Livrer ma semaine »** se fait par les dépôts arrivés, jamais par une coche. Pour les séries (ADR 0107), chaque demande compte seule dans la série de livraisons. Les publications faites pour elle (§ 18) sont une couche en lecture seule, comme les shifts. Ce ne sont pas des lignes de `creator_tasks` : elles ne se cochent pas et ne comptent pas.
26. **Le rappel du matin** est un job nouveau (seules les tâches à heures sonnent aujourd'hui). Sa clé est une par tâche et par jour, et il relit la tâche avant de sonner.
27. **« Accepter ma semaine »** est une route groupée et rejouable. Chaque suggestion y garde ses propres règles (placement, refus, passé). « Jour de tournage » et « Livrer ma semaine » entrent au glossaire avec le premier lot de code.

## Conséquences

Positives :
- Elle voit trois ou quatre lignes par semaine au lieu d'une tâche par demande. Elle sait quels jours elle travaille et ce qu'elle doit livrer.
- Le stock ne se vide plus en silence. Un script vide passe en tête de la semaine suivante.
- Rien ne dépend de l'IA pour être juste : sans modèle de langage, la semaine part quand même.

Négatives :
- Les durées estimées et la capacité d'un jour sont des réglages à tenir. Mal réglés, ils chargent trop ou trop peu sa semaine. Les mesures du point 21 servent à les ajuster.
- La tâche « Jour de tournage » est une sorte nouvelle de l'agenda : sa liste à cocher demande un changement de schéma, donc une migration.

## Alternatives rejetées

- **Une tâche par demande** (le fonctionnement actuel de l'ADR 0055 § 4) : c'est ce qui encombre la to-do.
- **Laisser l'IA choisir quoi tourner et quand** : ce n'est pas assez fiable pour de l'argent, et ça contredit la règle 3 de `CLAUDE.md`. L'IA rédige, elle ne décide pas.
- **Imposer les jours de tournage** : ça contredit l'ADR 0042 § 3. Elle les choisit, et le code range la semaine dedans.

## Choix de Charles (16/11/2026, 16 h 19)

a) Échéance : le dimanche à 23 h pour toutes les créatrices, modifiable par créatrice (§ 9).
b) Validation : il valide et corrige chaque semaine avant qu'elle parte, sans date de fin (§ 13).
c) Lives : rien d'automatique, la créatrice planifie les siens (§ 15).
d) Médias de Relance demandés chaque semaine, hors séances, pour les Mass DM (§ 4).

## Avenant du 20/11/2026 : le rythme dicté par Charles

Charles a fixé le rythme de la semaine. Il remplace les valeurs par défaut des § 4 et § 5 (le code les porte dans `WEEK_DEFAULTS`, réglables par créatrice plus tard) :

- **Séances boudoir** : trois par semaine dans l'idéal, deux acceptables. Une séance alimente tout : le post du feed (photos et vidéos de quelques secondes), une photo ou une vidéo pour le Mass DM qui annonce la séance, et quelques photos « cadeaux » jamais publiées et jamais nues. La fiche de la séance le dit, et « Livrer ma semaine » demande un média de Mass DM par séance. Cela remplace le choix d) : les médias de Relance viennent des séances, plus d'une ligne à part.
- **Vidéo du jour** : une par jour pour le feed vidéo public de Reveal, en une seule ligne coupée entre ses jours comme les stories. Elle n'est jamais reprise sur Instagram.
- **Story Reveal** : une par jour (inchangé).
- **Script** : un toutes les deux semaines. Sans script demandé ni script arrivé depuis quatorze jours, la semaine demande « Ton prochain script ».

Ses couleurs : chaque type de contenu a sa couleur sur la carte de la créatrice, qu'elle peut changer ; le choix est gardé sur son appareil. Instagram et Telegram (listes à cocher de sa journée, jamais de publication à sa place) feront l'objet d'un lot à part.

## Second avenant du 20/11/2026 : sa journée, Instagram et Telegram

Charles a fixé ce qu'elle publie chaque jour. Ce sont des listes à cocher dans « Ma journée », au-dessus de sa semaine dans son Agenda. Rien n'est jamais publié à sa place, et aucune automatisation ne touche Instagram.

- **L'essentiel du jour**, en tête et en grand : sa story Reveal, sa vidéo du jour sur le fil vidéo public de Reveal, et sa story Instagram qui mène à Reveal. Pour cette dernière, la carte explique pourquoi elle compte le plus : c'est elle qui fait venir les nouveaux abonnés. Elle se fait sage, avec le sticker lien.
- **En bonus**, par réseau, jamais en rouge : 3 autres stories Instagram (au moins 4 avec celle qui mène à Reveal), 2 posts Instagram, 1 Reel d'essai ; 2 posts écrits sur Telegram et, le soir, la vidéo du jour de Reveal sur son canal.
- Rien ne passe de Reveal à Instagram. La vidéo du jour peut aller sur Telegram.
- Le rythme vit dans le code (`DAY_DEFAULTS`), le même pour toutes jusqu'à ses réglages (lot 3). Seul ce qu'elle a fait est gardé : `creator_day_ticks`, une ligne par jour et par élément, écrite par elle seule sur son compte, le jour même ou le lendemain dans son fuseau. Son équipe la lit, et rien n'est supprimé.
- Chaque post a sa coche : une ligne de deux posts a deux coches. Ses couleurs couvrent aussi Instagram et Telegram.
