# 0112. Scripts à branches : les étapes et les branches de la plateforme, le code choisit la branche, la voix la dit

<!-- bandeau-rangement-2026-11-27 -->
> **Changée en partie depuis.** Le texte ci-dessous est d’origine et reste valable, sauf pour les passages qu’une décision plus récente remplace. Ce qu’elle dit remplacer, avec ses propres mots :
>
> - [0132 · Paliers de dépense : l'IA est plus proche et plus attentive avec ceux qui ont beaucoup dépensé, jamais plus pressante ; un prix plus haut par une branche de palier](0132-spender-tiers-per-creator.md) : **Amende l'ADR 0112 § 2** (« jamais les mêmes médias à deux prix ») pour la seule branche de palier du § 12 bis, sur décision de Charles du 16/11/2026 à 15 h 10.
>
> - [0161 · Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse](0161-only-our-scripts-impera-to-reveal.md) : Amende : l'ADR 0099 § 1 (deuxième temps, « importer les scripts existants ») et § 5 (ordre des descriptions), l'ADR 0098 § 6 (le cerveau choisit un script sur son identité validée) et l'ADR 0112 §§ 20 et 23 (la liste de l'onglet Scripts, la reconnaissance d'une copie).
>
> Toutes les décisions du même sujet : [`docs/regles/vente-et-scripts.md`](../regles/vente-et-scripts.md).
<!-- /bandeau-rangement-2026-11-27 -->

Statut : accepted (« ok 0112 » de Charles le 16/11/2026, 0 h 37, après ses choix du 16/11 à 0 h 00, 0 h 01, 0 h 02, 0 h 05 et 0 h 07, fil « Concevoir les scripts de vente à branches » ; relu par Agent et Médias). Amendement du 19/11/2026 (§ 20 à 26, créer un script à l'écran et le recopier dans Reveal) : accepted (Charles, 19/11/2026, 17 h 26 heure de Paris, « Oui, comme la maquette » sur la carte du fil)
Date : 2026-11-16
Précise : l'ADR 0098 (déroulé d'un script par fan), l'ADR 0099 (coffre et scripts de Reveal), l'ADR 0100 (rôle `script_writer`), l'ADR 0090 (objections), l'ADR 0103 (porte, ventes fictives au playground). Ne remplace rien : un script sans branche reste celui de l'ADR 0098.

## Contexte

Le 15/11/2026 au soir, Charles veut que l'IA vende par des scripts à branches, avec médias, prix et textes prédéfinis, les textes et le déroulé étant générés à partir du synopsis du script et des médias. Il veut reprendre l'éditeur d'étapes de l'outil concurrent qu'il utilise, dans le design system d'Impera, et s'inspirer des branches de Reveal.

**Ce que fait Reveal.** Une séquence est une liste d'**étapes** ; une étape tient **un ou plusieurs scripts** (un script de l'API = une étape envoyable : texte, médias vendus, aperçu, prix). Plusieurs scripts sur une même étape sont des **branches**, chacune avec une **condition en texte libre**, facultative, écrite pour le chatteur. Après l'envoi d'un script, le chat propose ceux de l'étape suivante ; rien n'est envoyé automatiquement. Le choix de la branche est donc humain.

**Ce que font les outils du marché** (lecture de leurs connecteurs, rien créé ni modifié) : des scripts linéaires. Une étape y porte un teaser avant le média, un message, les médias, un message après le média, une description de l'étape pour l'IA, un prix, un prix réduit ou plancher que l'IA accorde quand le fan hésite, et un nombre de messages avant l'étape suivante. Le script est créé inactif tant qu'il manque quelque chose, avec la liste de ce qui manque. Un routeur IA choisit le script sur sa description.

**Ce qui existe sur `main`** : le déroulé linéaire (ADR 0098, porte de l'ADR 0103) ; la synchronisation du coffre (#759) ; l'import des séquences (#761), qui lit aujourd'hui une séquence comme une liste plate d'étapes. Manquent, pour qu'un script soit proposable : la description des médias par la vision, l'identité de script validée (c8) et l'écran des scripts.

## Décision

### A. Le modèle : celui de Reveal, rendu jouable par une IA

1. **Un script = une séquence d'étapes ; une étape = une ou plusieurs branches ; une branche = une étape envoyable de la plateforme** (`stepRef` : médias, aperçu, texte d'offre, prix). Une étape à une seule branche est l'étape linéaire de l'ADR 0098. C'est exactement le modèle de Reveal : un script importé garde ses branches, un script composé dans le CRM se crée dans Reveal tel quel (ADR 0099 temps 3), et les chatteurs le voient comme aujourd'hui.

2. **Sorte d'une branche** : offerte, payante ou pont offert (ADR 0098 § 3). Toutes les branches d'une même étape n'ont pas à avoir le même prix, mais chacune a ses propres médias : jamais les mêmes médias à deux prix. **Une condition sur la dépense passée ne mène jamais à une branche moins chère que la branche par défaut de l'étape** (Charles, 16/11/2026 à 0 h 05 : seulement vers le haut, une branche premium aux autres médias) ; le code refuse à l'activation un tel script.

3. **Anatomie d'une branche** (reprise de l'éditeur concurrent, sans le prix réduit) :
   - figé, lu de la plateforme : **médias**, **aperçu**, **texte d'offre** (le message qui part avec le bundle), **prix** ;
   - tenu par Impera : **teaser avant le média** et **message après le média** (voir § 4), **description de la branche** (synthèse des seules descriptions validées de ses médias, ADR 0083, sans prix, refaite quand une description change, jamais par-dessus une version validée ; la phrase d'intention de l'agence est gardée à part), **condition** (§ B), **rythme** (§ C 9).

   **Une branche se nomme par son `stepRef`**, unique sur le compte, jamais par sa position : dans l'envoi (`sendScriptStep` reçoit l'étape et le `stepRef` de la branche), `script_runs`, `script_step_sent` et le journal. **La clé d'idempotence reste par conversation, script et étape**, jamais par branche : un rejeu ne peut jamais faire partir une deuxième branche de la même étape. Le rang lu chez Reveal (`platformIndex`) donne l'étape : plusieurs scripts au même rang sont les branches de cette étape. **Ce que Reveal ne donne pas, Impera le tient** (lecture du 16/11/2026 : la liste des séquences ne renvoie ni la condition, ni la branche par défaut, ni un ordre stable des branches) : l'ordre des branches, la branche par défaut et la condition structurée sont réglés par l'agence dans le CRM ; la condition en texte est saisie dans le CRM, ou reprise de Reveal quand une capture de l'écran d'édition aura montré où la lire. À l'import, une étape à plusieurs branches arrive sans défaut ni condition, dans l'ordre de création des scripts : le script reste inactif, avec ces manques nommés (§ 13), jusqu'à ce que l'agence les règle. Pour un script linéaire, rang et position coïncident : ses clés ne changent pas. L'identité de script (c8) reste au niveau du script : elle sert à le choisir au démarrage (ADR 0098 § 6) et couvre toutes ses branches ; le choix d'une branche passe par sa condition et sa description, jamais par l'identité. Le moment Jour ou Nuit se contrôle par script.

4. **Ce qui reste libre.** La voix écrit autour du bundle, dans la voix de la persona, sous ses gardes. Le teaser et le message après le média sont des **textes de base que la voix adapte** à la conversation sans en changer le sens ni rien promettre de plus que le média (Charles, 16/11/2026 à 0 h 01). Le texte d'offre qui part avec le bundle reste celui de la plateforme, mot pour mot. Elle ne dit jamais deux fois la même réplique au même fan (ADR 0090 § 8). Les textes de base arrivent à la voix dans le bloc typé `<script_step>` (ADR 0098 § 5), jamais dans le prompt.

### B. Comment l'IA évalue une condition

5. **Trois sortes de condition**, choisies dans l'éditeur (Charles, 16/11/2026 à 0 h 00 : structurée, puis texte, puis défaut) :
   - **aucune** : la branche par défaut de l'étape ;
   - **structurée**, évaluée par le code seul, sur une liste fermée : dépense passée chez la créatrice au-dessus d'un seuil (lue chez Reveal), une donnée de la fiche du fan (tranche d'âge connue, par exemple), la branche prise à l'étape précédente ;
   - **en texte**, celle de Reveal (« s'il a dit aimer… »), lue par le cerveau : parmi les branches de l'étape, il dit laquelle colle à la conversation, ou aucune, avec une phrase de raison. Il ne choisit qu'une branche de la liste ; le code vérifie.
     Le cerveau n'est interrogé qu'au tour où une étape est due (`send_step`), et ne voit que les conditions en texte des branches encore jouables de cette étape. S'il ne répond pas ou rend une branche hors de la liste, rien ne part à ce tour (fail closed, comme l'ADR 0098 § 6) : on ne retombe pas sur la branche par défaut.

6. **Ordre de décision**, tenu par le code : une branche structurée vraie l'emporte, sans que le cerveau soit interrogé ; sinon la branche en texte retenue par le cerveau ; sinon la branche par défaut ; à égalité, l'ordre des branches dans l'étape, fixé par l'agence. **Si rien ne s'applique et qu'il n'y a pas de branche par défaut, le script s'arrête proprement** : le déroulé passe à l'état nouveau `no_branch` (aftercare si une étape a été achetée, jamais d'improvisation), et ce script ne se rejoue jamais à ce fan (ADR 0098 § 1).

7. **Chaque choix laisse sa trace** : événement `script_branch_taken` (étape, branche, sorte de condition, raison du cerveau en une phrase, jamais le texte envoyé), montré dans « Pourquoi » au playground et dans la conversation côté agence.

8. **Ce qui ne mène jamais à une autre branche** :
   - un **refus**, dit ou par silence de deux messages : le déroulé passe à `refused` (ADR 0098 § 9) ; aucune branche « moins chère » ;
   - une **objection de prix** : sa réplique (ADR 0090), sans changer de branche ;
   - **l'heure** : Jour ou Nuit se fixe au niveau du script ;
   - une **demande sur mesure** : alerte et passation (ADR 0090).

### C. Le déroulé

9. **Rythme** : chaque étape porte un nombre minimum de messages du fan avant la suivante (3 par défaut, Charles, 16/11/2026 à 0 h 02 ; réglable étape par étape par l'agence). C'est un plancher tenu par le code, jamais une obligation de proposer : la porte, la note de désir et la même session restent maîtres. **Ce qu'on compte** : les messages du fan depuis l'achat de l'étape payante précédente, ou depuis l'envoi de l'étape offerte précédente. Le plancher ne vaut que devant une étape payante : l'aftercare et le pont qui suivent un achat partent comme le dit l'ADR 0098 § 8 ; la 0112 précise ce paragraphe en ajoutant le plancher avant l'étape payante suivante. Les deux messages qui font d'une étape payante ignorée un refus ne comptent pas dans le rythme : le refus tombe avant. C'est un compteur de messages du fan tenu dans `script_runs`, pas un compteur d'offres (ADR 0098 § 17 inchangé). Le fan qui demande à acheter ne contourne ni la porte de l'ADR 0103 ni ce plancher.


9 bis. **Messages autour du média et leurs déclencheurs** (Charles, 16/11/2026 à 0 h 38 et 0 h 42). Chaque étape peut porter, en plus du teaser, jusqu'à trois messages après le média, chacun facultatif, avec son délai réglable par l'agence :
   - **juste après** : part X secondes après l'étape, pour donner envie ; il ne compte pas comme une relance ;
   - **pas lu** : part si le message de l'étape n'est pas lu au bout de X secondes (Reveal dit si un message est lu, `memberLastReadAt`, pas si le média est ouvert) ;
   - **lu, pas acheté** : part si l'étape payante est lue mais pas achetée au bout de X secondes.

   **Une seule relance au plus par étape payante** : « pas lu » ou « lu, pas acheté », la première qui se déclenche ; l'autre ne part plus. Un message à déclencheur ne part que si le fan n'a rien écrit depuis l'étape : s'il a répondu, la voix répond à ce qu'il dit. Chaque message est un texte de base adapté par la voix (§ 4), sous toutes les gardes (pas de remise, pas de culpabilisation). Il précise la relance courte de l'ADR 0098 § 10 et ne change ni le refus par deux messages ignorés (§ 10) ni le refus final. Le délai le plus court utile suit le rythme de lecture du connecteur (de l'ordre de 30 secondes). **Revérifié au moment d'envoyer** : un message à déclencheur tombe si, entre-temps, la conversation est passée à un humain, en mode soin, fragile ou à risque, si l'agent est coupé (mode ou arrêt général) ou si le déroulé est fermé. **Bornes de temps** : il ne part jamais après la fin de la session chaude (§ 10) ni hors des heures où elle répond ; il ne se décale pas, il tombe. **Pas de doublon avec les relances de silence** : un message à déclencheur compte comme le dernier message de la créatrice pour le plan de relances, et ce plan ne démarre pas tant qu'un déclencheur attend. Sa clé d'idempotence est par conversation, étape et déclencheur : un job rejoué ne l'envoie jamais deux fois.

10. **Toutes les règles de l'ADR 0098 et de l'ADR 0103 tiennent branche par branche** : porte avant le premier teaser ; politique d'offre avant tout démarrage et toute étape payante ; étape payante ignorée deux messages = refus ; pas de teasing avant la fin du délai entre scripts ; même session, jamais de reprise le lendemain ; pont permis après une étape offerte ; prix revérifié à l'envoi, étape au prix changé retenue avec l'alerte `script_price`.

11. **Média déjà reçu** (précise l'ADR 0098 § 6) : **au départ**, un script n'entre dans la liste permise que s'il reste au moins un chemin complet sans média déjà reçu, depuis une première étape qui a une branche jouable pour ce fan ; **en cours de route**, une branche dont un média a déjà été reçu est retirée des choix, et une étape sans branche jouable met le déroulé en `no_branch`.

12. **`script_runs` garde, pour chaque étape, la branche prise (`stepRef`)** et le compteur du rythme. **Reveal gagne aussi sur la branche** : le `stepRef` lu dans l'historique donne l'étape et la branche ; si un chatteur a envoyé une autre branche, c'est celle de Reveal qui compte, et une branche que le déroulé croyait partie et que Reveal ne connaît pas est redécidée, pas renvoyée telle quelle. La porte de l'ADR 0103 passe avant le choix de branche de la première étape.

### D. Un script prêt à l'emploi

13. **Créé inactif, avec la liste de ce qui manque** (repris de l'éditeur concurrent) : nom, description du script, et pour chaque branche ses médias, ses descriptions validées, son texte d'offre, son prix si elle est payante. Un bouton mène au premier manque. Un script ne s'active que sans manque et par un humain.

14. **Refusé à l'activation** : un même média deux fois sur un chemin, un mélange Jour et Nuit, une branche qui touche un dégoût de la persona, une condition structurée hors de la liste, deux branches par défaut dans une étape. **Avertissements** (pas des refus) : prix de P6-01 (plus du double de l'étape payante précédente, plus de 40 € TTC) calculés chemin par chemin ; une étape sans branche par défaut.
   *Avenant du 27/11/2026 (Charles, carte « Prix fixe, escalier gardé » et précision de 13 h 40 ; ADR 0098, avenant du même jour) :* refusée aussi, comme un manque (`price_not_above_previous`), une branche payante qui ne coûte pas **strictement plus** que la dernière étape payante de son chemin, chemin par chemin, ponts et étapes offertes sautés ; rien de plus n'est exigé. Une branche sur la dépense passée (la branche de palier de l'ADR 0132 § 12 bis, aujourd'hui `spent_at_least`) ne prévient qu'au-delà d'un multiple réglé par l'agence (`spendBranchJumpMultiple`, avertissement `price_jump_over_setting`) quand ce réglage existe ; sans lui, l'avertissement d'origine s'applique. L'avertissement de plafond ne change pas.

### E. Écrire un script

15. L'agence écrit un **synopsis** (thème, situation, envie servie, intensité finale) et choisit ses médias dans le coffre. Le rôle `script_writer` (ADR 0100) propose les étapes, au plus deux branches par étape au départ, leurs conditions, teasers, textes d'offre, messages après le média et la description du script. Ni prix, ni seuil : ils viennent de la grille de l'agence. `script_writer` est le seul générateur de ces textes : les textes de vente de SC-05 s'y rangent. Ses clés de segment (ADR 0100) deviennent le `stepRef` de la branche. Schéma Zod, gardes dures, puis relecture humaine : un script à branches est **toujours** relu, même si la créatrice est en automatique (ADR 0100 § 3). **Exigence d'écriture** (Charles, 16/11/2026 à 0 h 07 : un texte vécu, naturel, spontané, dans la personnalité de la créatrice, jamais le sentiment pour le fan d'être un portefeuille) : `script_writer` écrit à partir de vrais exemples de la créatrice (la banque d'exemples de l'ADR 0102 et les réponses typiques de sa persona), pas d'une seule consigne de style ; chaque texte s'ancre sur un détail concret des descriptions validées et sur la situation du synopsis ; il parle d'elle et de lui avant de parler du média, et ne nomme jamais un prix. Ce n'est qu'un **premier jet** : chaque branche se valide une par une, texte par texte (pas de « tout valider » pour un script), et chaque retouche est gardée pour mesurer (ADR 0100 § 4). Une fois validé, le texte d'offre est figé ; tout ce qui l'entoure est écrit en direct par la voix à partir de ce que le fan vient de dire. Un même fan ne relit jamais une phrase : un script ne se rejoue pas, et la voix ne reprend pas une tournure déjà envoyée à ce fan.

16. Modifier un script actif crée une nouvelle version, et chez Reveal **un nouveau script** (nouveau `scriptRef`) : jamais une modification sur place tant qu'un déroulé est ouvert, puisqu'un déroulé se recolle à Reveal par `stepRef`. Un déroulé garde la version de son début.

### F. L'écran

17. **L'éditeur reprend l'anatomie de l'outil concurrent, dans le design system d'Impera** : en tête le nom, la description et le bandeau « ce qui manque » ; puis une carte par étape, repliable, déplaçable ; dans une carte, les branches côte à côte (onglets au téléphone), chacune avec sa condition en tête et ses champs dans l'ordre d'envoi : teaser, texte d'offre, médias (vignettes floutées, choisies dans le coffre synchronisé), message après le média, description, prix, rythme. Un rail montre l'escalier de prix de chaque chemin avec ses avertissements. Aucun contrôle natif.

18. **Playground** : on joue le fan sur les vrais scripts (ADR 0103 § 15–18) ; « Pourquoi » dit l'étape, la branche et la condition qui l'a choisie.

19. **Mesure** : par script, étape et branche, taux d'ouverture, taux d'achat et revenu.

## Amendement du 19/11/2026 : créer un script à l'écran, le recopier dans Reveal (accepté)

Le 17/11/2026, Charles constate que l'onglet Scripts de la fiche montre le coffre mais ne permet pas de créer un script. L'ADR 0149 range la liste des scripts et « Nouveau script » dans l'onglet Scripts de la fiche à sept onglets. La maquette de l'éditeur (données inventées), revue trois fois avec lui les 17 et 19/11, est validée le 19/11/2026 à 16 h 59 heure de Paris (« je valide », fil « Concevoir les scripts de vente à branches »). Les écritures de séquence de Reveal ne sont toujours pas capturées : Impera ne crée rien chez Reveal.

20. **L'onglet Scripts de la fiche** (ADR 0149 § 1) a trois vues, dans un même sélecteur : « Scripts » (les scripts importés de Reveal et les scripts en préparation, en une liste, avec « Nouveau script » en action principale), « À copier dans Reveal » et « Structures » (propriétaire seul, l'écran actuel inchangé). L'adresse garde la vue et le script ouverts : `vue=a-copier|structures`, `script=nouveau|<id>`. L'éditeur s'ouvre en pleine page, les onglets de la fiche toujours visibles, avec un retour « ← Scripts ».

21. **Un script créé à l'écran est un script en préparation** (pas un « brouillon », mot réservé aux réponses de l'agent). Il a les mêmes champs, les mêmes manques et les mêmes refus que tout script (§ 13, § 14). Ses médias se choisissent seulement parmi les médias importés et décrits du coffre de la créatrice (ADR 0145 § 5). Il porte son moment (« se joue le jour » ou « la nuit »), qui sert au refus du mélange (§ 14). Un script en préparation n'est jamais proposé ni envoyé : il n'a pas de `scriptRef`.

22. **Recopie à la main.** Un script en préparation sans manque peut passer « Prêt à copier ». Il apparaît alors dans la vue « À copier dans Reveal » avec sa marche à suivre pas à pas : séquence au même nom, étapes dans l'ordre, branches d'une même étape au même rang, prix et médias de chaque branche. Quelqu'un de l'agence le recopie dans Reveal ; l'écran n'y écrit rien.

23. **L'import suivant le reconnaît.** Une séquence importée se rattache à un script prêt à copier seulement si tout correspond : même nom, même nombre d'étapes, mêmes branches à chaque rang, mêmes médias et mêmes prix. Les réglages qui ne vivent qu'à Impera (conditions, messages après le média, rythme) passent alors sur le script importé, qui reçoit son `scriptRef`, et le script en préparation se ferme. Sans correspondance exacte, rien n'est rattaché, et la fiche dit ce qui diffère. L'activation reste humaine et sans manque (§ 13).

24. **Le rail de l'éditeur** (§ 17) ne dessine plus d'escalier de prix. Il montre, pour chaque chemin, ce qu'un fan paie étape par étape et au total, avec ses avertissements (§ 14) ; un avertissement commun à tous les chemins ne s'écrit qu'une fois. Au-dessus, un résumé de la version active renvoie à ses performances.

25. **La mesure** (§ 19) a sa vue dans l'éditeur, « Performances », à côté de « Construire ». De haut en bas : une phrase qui dit ce que rapporte la version active et l'étape à travailler en premier ; des tuiles avec leur évolution par rapport à la période d'avant de même durée, et une mini-courbe chacune ; « À faire », des pistes tirées des chiffres, la plus urgente d'abord ; « Pourquoi » : où les fans s'arrêtent à chaque étape (achat, réponse sans achat, lu sans réponse, pas lu) et le taux d'achat de chaque branche avec son intervalle de confiance, hachuré tant que l'échantillon est trop petit ; puis le revenu par fan, semaine par semaine. La liste compare les scripts sur 7, 30 ou 90 jours. Les chiffres sont calculés côté serveur, jamais par l'écran ; le seuil d'échantillon est une règle du code.

26. **Couleurs** : l'encre pour les quantités, l'or de la vente pour les achats, le vert et l'ambre seulement pour le sens d'une évolution, comme sur le Dashboard. Les branches n'ont pas de teinte à elles : le bleu et le rose disent déjà l'agence et la créatrice. Chaque graphique a une bulle de survol. Les sélecteurs reprennent la barre d'onglets de la fiche.

Conséquences de l'amendement : une migration (Bilan) pour garder le script en préparation, son moment, son état « prêt à copier » et son rattachement ; la reconnaissance à l'import s'ajoute à l'import des séquences ; la vue Performances lit les tables d'envoi et d'achat existantes, sans nouvelle donnée de fan.

## Amendement du 20/11/2026 : jour, nuit, ou jour et nuit (accepté)

Décision de Charles du 20/11/2026 (16 h 48, heure de Paris), relayée par le coordinateur.

27. **Le moment d'un script en préparation** (§ 21) prend trois valeurs : « se joue le jour », « la nuit » ou « jour et nuit » (un script polyvalent). La créatrice ou l'agence le choisit à la main sur le script. Il ne se déduit jamais de la description des médias, qui décrit ce qu'elle voit (tenue, couleur, lieu) sans trancher le moment. Le nom recopié dans Reveal est celui du script, sans emoji ajouté par Impera. Pour l'agent, un script « jour et nuit » n'a pas de moment imposé (ADR 0098 § 3).

## Conséquences

Positives :
- Le modèle est celui de Reveal : import et création sans traduction, chatteurs et IA lisent les mêmes scripts.
- L'IA suit ce que le fan exprime sans inventer ni prix ni contenu, et chaque choix se relit.

Négatives :
- Une branche demande ses propres médias.
- La condition saisie dans Reveal n'est pas lue par l'API des séquences : tant qu'une capture de l'écran d'édition ne montre pas d'où la lire, elle se ressaisit dans le CRM.
- Une migration (Bilan) : la branche et le compteur du rythme dans `script_runs`, le `stepRef` dans `script_step_sent`, l'état `no_branch` ; `script_branch_taken` entre au contrat.
- L'import actuel (#761) lit une séquence comme une liste plate ; c8 marque déjà deux branches sur un même rang `branched_step`, jamais proposable. Il doit apprendre l'étape, l'ordre de la branche et sa condition (capture d'une séquence à branches nécessaire), et l'envoi doit viser le `stepRef` au lieu de la position.
- Les avertissements de prix (`priceWarnings`, linéaire aujourd'hui) passent au calcul chemin par chemin ; les vignettes de l'éditeur attendent la lecture des fichiers du coffre.
- La création dans Reveal attend la capture des écritures de séquence.

## Alternatives rejetées

- **Prix réduit ou plancher quand le fan hésite** (outils du marché) : une négociation ; Impera n'en fait jamais.
- **Branche « moins cher » après un refus** : une remise déguisée.
- **Condition en texte seule, sans sorte structurée** : le code ne pourrait rien vérifier sur la dépense ou la fiche.
- **Graphe libre avec retours en arrière** : plus difficile à lire, incompatible avec Reveal, et un pack ne se repropose jamais.
- **Laisser le modèle choisir librement l'étape suivante** : la vente vit dans le code.
