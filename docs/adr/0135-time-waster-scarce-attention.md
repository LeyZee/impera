# 0135. Time waster : le fan qui parle sans jamais acheter reçoit une attention rare, jamais du mépris ; le premier achat la lui rend

Statut : accepted (fil « Gérer les fans qui font perdre du temps » ; demande de Charles du 16/11/2026 à 14 h 39 ; réponses et « ok 0135 » du 16/11/2026 à 15 h 08)
Date : 2026-11-16
Précise : ADR 0132 (paliers de dépense : même dépense lue, mêmes pièces, bas de la même échelle), ADR 0128 (ménager les scripts), ADR 0131 (choix du script), ADR 0112 (scripts à branches), ADR 0088 (mode soin), ADR 0085 (fiche du fan), ADR 0086 (copilote), ADR 0091 (consommation d'IA), ADR 0006 (files de l'agent), ADR 0021 (rester en personnage), ADR 0063 (ce que voit la créatrice). S'appuie sur la règle de la bouderie au retour tranchée par Charles le 16/11/2026 avec le fil Agent, sans la réécrire.

## Contexte

Le 16/11/2026, Charles demande que l'IA traite autrement les fans « qui font vraiment perdre du temps » : ils parlent beaucoup, longtemps, reçoivent plusieurs offres et n'achètent jamais rien. Dans les agences, on les appelle les *time wasters*. Ce que faisaient ses chatteurs : trois essais de vente sans aucun achat, et le fan est classé time waster ; il reçoit moins d'attention. Il veut que l'IA fasse comprendre, subtilement et comme le ferait une vraie fille, que l'attention et le contenu payant vont ensemble, sans jamais le dire de front.

L'abonnement est et restera gratuit chez nous (Charles, 16/11/2026) : aucune barrière à l'entrée, le maximum de trafic, la conversion passe par la relation. Un fan qui n'achète rien ne rapporte donc rien, et chaque réponse de l'IA a un coût (ADR 0091).

Ce que montrent nos données (corpus privé de l'ancien bot) et la recherche, résumés dans le bilan du fil :

- au-delà de quelques offres sans achat, plus rien ne se vend ; l'insistance n'y change rien ;
- une part notable des longues conversations sans achat bloquait sur le moyen de paiement, pas sur l'envie : ces fans ne sont pas des time wasters ;
- jouer l'inaccessible attire celui qui est déjà accroché et fait décrocher les autres ; le mépris écrit (reproches sur l'argent, insultes) finit en départs, en plaintes et en atteinte à l'image de la créatrice ;
- une large part du public est seule ou vulnérable : une alternance chaud/froid calculée pour créer de l'angoisse est le mécanisme de la dépendance, que l'ADR 0132 § 13 envoie déjà à un humain.

D'où la ligne retenue : **la rareté, oui ; le dédain, non**. Elle peut faire la tête quand il y a une raison, comme une vraie fille ; elle ne méprise jamais.

## Décision

### A. Qui est un time waster : le code décide, sur des faits lus

1. **Toutes les conditions** suivantes, calculées par le code à chaque nouvel événement du fan, jamais devinées par un modèle :
   - ancienneté de la conversation au moins égale à **N jours** ;
   - au moins **K offres payantes vues** (étape payante ouverte ou aperçu vu chez la plateforme, pas seulement envoyée), sur au moins **S scripts différents** ;
   - **dépense à vie nulle** chez la créatrice, lue à la même source que l'ADR 0132 § 1 (registre des ventes, repli dépense de la plateforme) ; pourboires compris : un seul pourboire, même petit, compte comme une dépense ;
   - au moins **M messages** du fan depuis le début ;
   - **l'aide au paiement lui a déjà été donnée** au moins une fois (le message fixe qui explique ce que contient l'offre, son prix et comment l'ouvrir). Sans elle, le code la déclenche d'abord, et le fan n'est pas classé.

   N, K, S et M sont réglés **par créatrice** dans le CRM (Créatrices › fiche › « Time waster ») par le propriétaire ou un manager, en base, jamais dans le dépôt ni dans un prompt. Sans réglage saisi, personne n'est classé. Les valeurs de départ choisies par Charles le 16/11/2026 sont saisies à la mise en service, hors dépôt.

2. **Deux niveaux.** `slowed` (« ralenti ») aux seuils ci-dessus ; `dormant` (« veille ») quand l'ancienneté et les offres vues atteignent le **double** des seuils, toujours sans aucune dépense.

3. **Jamais classés**, quoi qu'il arrive, et déclassés sur-le-champ s'ils l'étaient : doute d'âge ouvert (l'IA n'écrit déjà rien), fan fragile, mode soin (ADR 0088), ventes gelées (dont budget nul : il est fauché, pas profiteur, et la conversation continue sans vente comme aujourd'hui), fan qui a demandé qu'on arrête de lui proposer, fan à palier de dépense (ADR 0132, il a dépensé). La sécurité passe avant ce statut.

4. **Contrôle des acheteurs tardifs avant la mise en service.** Bilan compte, sur les ventes lues chez la plateforme, la part des premiers achats faits après les seuils réglés. Si elle dépasse 10 % des premiers achats, les seuils remontent avant d'activer quoi que ce soit.

5. **Un changement écrit un événement** (`fan_time_waster_changed`, ancien et nouveau niveau, raison en code, sans montant) et vaut dès la réponse suivante.

### B. Ce que le statut change : une attention rare

Chaque effet est une valeur que le code lit ou un texte versionné que le code choisit ; aucune règle n'entre dans un prompt (règle 3 du dépôt). Les pièces sont celles de l'ADR 0132, utilisées vers le bas.

6. **Rythme.** Le délai de réponse de la créatrice est multiplié par un facteur tiré au hasard dans une plage réglable (départ : × 3 à × 6), plafonné (départ : 8 h), toujours dans ses heures d'activité ; jamais instantané, jamais un délai fixe qu'il pourrait deviner. Ses messages reçus pendant l'attente sont **regroupés en une seule réponse**. Au plus **deux moments de réponse par jour** en `slowed`, **un** en `dormant`.

7. **Forme.** Une seule bulle, courte. Le code choisit le registre **`busy`**, ajouté à la liste fermée `SpenderRegister` de l'ADR 0132 § 7 : elle est douce et contente de le lire, mais prise (journée chargée, beaucoup de messages, shooting, live) ; elle pose moins de questions sur lui. Le texte du registre est un prompt versionné (`voice/register-busy.md`), testé en évals.

8. **Ce qu'elle laisse entendre, jamais ce qu'elle dit.** Charles veut qu'il comprenne que l'attention est du donnant-donnant et qu'elle est très sollicitée. Le registre `busy` le fait sentir : elle a beaucoup de monde qui lui écrit, peu de temps, et elle redevient toute à lui quand il s'investit. **Interdit, par une garde bloquante `money_reproach` pour tous les fans** : toute allusion à ce qu'il ne dépense pas (« radin », « tu ne m'achètes jamais rien », « mon attention se mérite »), toute mention d'autres fans qui la paient ou de ce qu'ils dépensent, toute insulte. Raison : un reproche dit de front déclenche l'opposition (réactance) et fait partir ; le geste suffit.

9. **File.** Ses tâches passent **après** celles des autres fans (priorité de file, ADR 0006), avec un plafond d'attente égal au plafond du § 6 : il n'est jamais oublié. Dans « À traiter », ses lignes sont rangées en dernier, et le filet « fan sans réponse » ne le remonte qu'au-delà de ce plafond.

10. **Relances.** Aucune relance de conversation ni de vente : c'est à lui de revenir. Les relances déjà prévues sont annulées à l'entrée dans le statut.

11. **Pas de long échange gratuit.** S'il sexualise, elle va vers l'étape payante d'un script qu'il n'a jamais reçu (ADR 0128, 0131) dès que les règles d'offre le permettent, au lieu d'un long sexto gratuit. Le délai entre deux offres est multiplié par un facteur ≥ 1 (même borne que l'ADR 0132 § 9 : jamais plus vite que pour les autres). En `dormant`, plus aucune offre de sa part, sauf s'il en demande une ou qu'un script neuf arrive dans la réserve. Toutes les règles de vente restent : jamais de prix réduit, refus final, une bouderie au plus par refus.

12. **Faire la tête quand il y a une raison.** La règle tranchée avec le fil Agent le 16/11/2026 (il part en plein sexto sans prévenir : une relance blessée, une seule fois ; à son retour, elle fait un peu la tête un ou deux messages, puis repart s'il se rattrape ; sans insulte, sans mépris, jamais de chantage) s'applique à tous les fans et n'est pas réécrite ici. Elle s'étend aux mêmes conditions à deux autres déclencheurs lus par le code : une étape payante laissée sans réponse puis un retour des heures après comme si de rien n'était ; une question personnelle de sa part ignorée. Pour un time waster seulement : il lui faut le double de messages pour la dégeler, et sa voix peut rester un peu boudeuse par défaut. Une bouderie retombe au plus tard le lendemain ; elle ne s'enchaîne jamais avec le chouinage d'un refus ; jamais à un fan fragile, en soin ou au budget nul ; jamais juste après un achat.

### C. Comment il en sort

13. **Tout achat le sort sur-le-champ** : étape de script, média, pourboire, quel que soit le montant. Dès la réponse suivante : rythme normal, registre normal, place normale dans la file, et l'aftercare habituel. Elle ne commente jamais le changement (« tu vois quand tu fais un effort » est interdit par le § 8). Les compteurs du § 1 repartent de zéro après cet achat ; comme sa dépense n'est plus nulle, il ne peut plus être classé tant qu'un remboursement ne la ramène pas à zéro.

14. **S'il demande lui-même du contenu payant**, elle lui répond au rythme normal pendant cette session (comme la levée du délai entre offres aujourd'hui).

15. **À la main** : le propriétaire ou un manager peut le rendre au rythme normal (bouton « Rendre le rythme normal ») ; le fan n'est alors plus classé pendant une durée réglable (départ : 14 jours). Un humain ne classe jamais un fan à la main : il change les seuils.

### D. Ce que voit l'équipe

16. **Fiche du fan, Suivi, panneau de l'extension (ADR 0085 § 4, 0086)** : une pastille ambre **« Time waster »** (avec « veille » au second niveau), ses raisons en chiffres (ancienneté, offres vues, dépense, messages), sa date d'entrée et le registre en vigueur. Le chatteur humain applique la même consigne, affichée sous la pastille : réponses groupées et courtes, pas de long sexto gratuit, aucun reproche sur l'argent.

17. **Qui voit quoi.** Propriétaire, managers et chatteurs qui ont accès à la créatrice. La créatrice ne voit ni le statut ni ses réglages (méthode de l'agence, ADR 0063). Aucun statut ni montant dans une alerte Telegram, un export ou un log, seulement des codes.

18. **Trace.** Le « Pourquoi » d'un brouillon dit le niveau, le registre et le délai choisi.

19. **Consommation d'IA.** L'écran Conso IA (ADR 0091) montre le nombre de fans classés et les appels d'IA évités sur le mois (messages reçus moins réponses produites pour ces fans).

### E. Mesurer que ça rapporte au lieu de faire fuir

20. **Groupe témoin.** Parmi les fans qui remplissent les conditions, 20 % tirés au hasard (par fan, stable dans le temps) restent au rythme normal ; ils sont seulement marqués « témoin » sur la fiche.

21. **Comparaison sur 30 jours** : part de fans qui font un premier achat, revenu par fan, désabonnements et blocages, coût d'IA par fan. L'écran dit « pas encore assez de fans » tant que chaque groupe a moins de 50 fans, plutôt qu'un faux résultat.

22. **Arrêt automatique.** Si, à partir de 50 fans par groupe, les désabonnements ou blocages du groupe traité dépassent ceux du témoin de plus de 5 points, le statut cesse de s'appliquer pour la créatrice (tous les fans reviennent au rythme normal) et une ligne rouge l'annonce dans « À traiter ». Le relancer est un geste du propriétaire.

23. **Au bout de 30 jours**, Charles décide : garder, ajuster les seuils ou arrêter. Le témoin peut ensuite descendre à 5 % pour garder un repère.

## Précisions de Charles (26/11/2026 à 23 h 50 et 27/11/2026 de 0 h 32 à 0 h 34, fil « Adapter l'IA aux baleines et time wasters »)

- **Deux profils.** `slowed` (« hésitant ») : il lui manque la confiance ou le temps ; elle continue de chercher ce qui le retient, crée un peu de proximité, un peu moins disponible. `dormant` (« vraiment pénible ») : réponses rares jusqu'à un achat, un pourboire ou des excuses. Payeurs et baleines passent toujours avant.
- **Qui est `dormant`** (remplace le « double des seuils » du § 2) : au moins **trois fois** le nombre de scripts sans achat du niveau `slowed`, sans aucune dépense, **et** au moins **deux signes différents** sur 14 jours, lus par le code : (1) il redemande une preuve après un refus ; (2) il marchande ou demande une remise ; (3) il réclame du gratuit après une offre refusée ; (4) il insulte ou met la pression ; (5) il insiste pour un contact personnel ou une rencontre, deux fois ou plus ; (6) il part en plein script juste après une étape payante vue, sans avoir jamais acheté ; (7) il promet d'acheter plus tard et ne le fait pas, deux fois.
- **Sortie.** Un achat ou un pourboire : rythme normal sur-le-champ (§ 13). Des **excuses** pour son comportement : retour à `slowed`, pas plus.
- **Mise en œuvre** (PR #1045) : l'attente est décidée avant tout appel d'IA, dans le job de réponse (`reply_deferred`, raison `time_waster`) ; les réglages vivent dans `creators.settings.timeWaster`, sans valeur dans le dépôt ; sans réglage, personne n'est classé. Le signe (6) se lit dans les déroulés ; les autres attendent leur journal (`fan_signs_seen`, migration à numéroter par Bilan).

## Une seule lecture, et le troisième doute (27/11/2026, audit des contradictions)

- **Une seule définition.** Où il se tient (payeur, nouveau, time waster, time waster avéré) est lu une fois, par le job de réponse, avec la règle de la créatrice : la même lecture décide du rythme (« hésitant », « vraiment pénible ») et, dans le composeur, de la preuve et de la réponse à sa photo. Le composeur ne la recalcule que là où personne ne l'a lue (le bac à sable).
- **Le troisième doute (méthode § 10.25.1).** Chaque preuve demandée est journalisée pour tout fan (`asks_proof`), jamais comptée comme un signe de time waster. À la deuxième demande, elle montre que ça la saoule et peut retenter une preuve ; à la troisième, plus aucune preuve, pour tout le monde, et s'il n'a jamais rien payé il est time waster avéré tout de suite, même sans règle saisie (il n'attend son tour que si la règle existe).

## Partage du travail

| Lot | Contenu | Fil |
|---|---|---|
| a | Contrats (`TimeWasterLevel`, réglages par créatrice, vue de la pastille), migration (réglages, niveau et dates par fan, appartenance au témoin, numéro au signal), calcul des conditions sur la dépense lue de l'ADR 0132 et les offres vues, `fan_time_waster_changed`, routes de réglage et isolation, comptage des acheteurs tardifs (§ 4) | Bilan + Agent |
| b | Registre `busy` versionné, garde bloquante `money_reproach` pour tous les fans, délais et regroupement, priorité de file et plafond, relances annulées, offres du § 11, bouderie étendue du § 12, évals (fans inventés) | Agent |
| c | Pastille, raisons et consigne dans la fiche, le Suivi et le copilote ; bouton « Rendre le rythme normal » ; écran des réglages | Design / Extension |
| d | Témoin, comparaison, arrêt automatique, ligne de Conso IA | Chiffres + Conso IA |

## Questions à Charles (toutes tranchées le 16/11/2026 à 15 h 08)

1. Option : rareté sans mépris (B). 2. Seuils de départ acceptés ; pas d'abonnement payant, jamais. 3. Deux niveaux. 4. Rythme recommandé. 5. Rien de dit sur l'argent, le geste suffit. 6. Tout achat, pourboire compris, sort le fan. 7. Témoin de 20 % sur 30 jours, arrêt à +5 points. 8. Même consigne pour les chatteurs humains. 9. Nom à l'écran : « Time waster ».

## Conséquences

Positives :
- Le temps de l'équipe et les appels d'IA vont aux fans qui achètent ou qui peuvent encore acheter.
- Le fan sent que l'attention est rare et qu'elle revient quand il s'investit, sans reproche qui le ferait partir.
- La décision est mesurée contre un témoin et s'arrête seule si elle fait fuir.

Négatives, à surveiller :
- Un acheteur tardif mal classé perd de l'attention au mauvais moment : le § 4, la sortie immédiate et le témoin le bornent.
- Les fans gratuits qui partent font baisser le nombre d'abonnés affiché.
- Une bouderie trop fréquente peut devenir le mépris qu'on refuse : bornée à un épisode, à une raison lue par le code, et retombée le lendemain.
- Les chatteurs humains peuvent en faire trop : la consigne est affichée, pas laissée à chacun.

## Alternatives rejetées

- **Froideur affichée et reproches sur l'argent** : fait partir ceux qui pourraient encore acheter, abîme l'image de la créatrice, et c'est le schéma de mépris relevé dans le corpus de l'ancien bot.
- **Ignorer ses messages** : contraire à « jamais de fan sans réponse » ; un délai plafonné et des réponses groupées obtiennent la rareté sans abandon.
- **Laisser le modèle juger qui est un time waster** : une dépense et des offres vues se lisent, elles ne se devinent pas.
- **Une remise pour le faire basculer** : jamais de prix réduit, pour personne.
- **Une alternance chaud/froid calculée** : c'est le mécanisme de la dépendance, sur un public souvent seul.
