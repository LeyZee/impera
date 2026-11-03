# CRM-04 Ventes en direct : alertes, chiffre d'affaires et gains de la créatrice

Statut : in_progress. Lot a fusionné (#449, 03/11/2026) ; les six questions d'argent et de règle (fin de fiche) acceptées par Charles le 03/11 à 09h32 (« ok recos ») ; lots b à d ouverts (ADR 0050, fiche acceptée par Charles le 02/11/2026, détaillée par Équipe et relue par Bilan le 03/11).
Phase : API CRM (ADR 0050)
Dépend de : CRM-01 (fait). CRM-03 pour la bascule (lot d). CR-02 (accès de la créatrice) et CR-04 (écran Ventes) pour le lot d.
Branche : une par fil, comme d'habitude ; une PR par lot.
Code : Équipe. Relectures : Bilan pour `connectors`, `contracts` et `db` ; le fil Telegram pour `telegram` ; le fil Agent pour `supervision` ; Extension pour chaque écran ; Équipe relit tout montant.

## Objectif

Chaque vente lue chez Reveal sonne une fois, au bon endroit. Le Dashboard, le bilan du soir et l'écran de la créatrice montrent les mêmes chiffres que Reveal, au centime, tirés d'un seul calcul.

## Ce qui existe déjà (03/11)

- **Le registre des ventes** (`platform_sales`, CRM-01). Il garde une ligne par vente et événement, avec les montants de Reveal en centimes : brut TTC, hors TVA, `netAmount`, `agencyRevenue`, `modelRevenue`. Il est sous RLS par créatrice. Le chatteur de la ligne est relié à un membre ou à l'agent dans `sales_feed_chatters`. Le fan n'y est que par son identifiant chez Reveal, jamais par son pseudo.
- **`sale_detected`** existe dans le contrat des événements. Telegram le classe dans le sujet « Ventes », mais personne ne le publie encore.
- **Telegram** (P3-07) : le sujet « Ventes » et son routage sont prêts, et le bilan du matin tourne. Il manque les réglages des ventes et le bilan du soir.
- **Le Dashboard** lit son chiffre d'affaires dans les messages payants capturés. Sans capture, il ne montre rien.
- **Les notifications push** (CR-01) connaissent la raison `sale`, la rafale de plus de 3 ventes en 2 minutes et les heures calmes.
- **La créatrice** : CR-02 (accès) et CR-04 (gains) sont à faire. Le pourcentage de l'agence par créatrice n'existe pas encore.

## Une seule règle de calcul

Une fonction pure, `salesTotals`, dans le domaine de `connectors`, avec son port de lecture `salesFeedTotals.totalsOf(tx, creatorId, plage)` exporté par l'`index.ts`. Le Dashboard, le bilan du soir et l'écran de la créatrice la lisent tous ; aucun ne refait de somme.

- Le jour est celui de la vente, dans le fuseau de la plateforme. Un remboursement se retranche du jour de sa vente. C'est la règle de la vérification de CRM-02, la même que celle des statistiques de Reveal : les totaux d'un mois redonnent donc `/v1/stats/daily` au centime. Elle n'est pas réécrite : elle est extraite de `reliability-check.ts` (`domain/sale-days.ts`) et partagée avec CRM-02 (Bilan).
- Pour chaque compte, jour, type de vente et vendeur (un membre, l'agent, un chatteur non relié, ou personne : les quatre cas de l'auteur que lit la paie), elle donne le nombre de ventes et de remboursements, le brut TTC, le hors TVA, le net, la part de l'agence (`agencyRevenue`) et la part de la créatrice (`modelRevenue`).
- Elle ne fait que des sommes. Aucune TVA ni commission n'est recalculée (ADR 0050 § 8). Chaque devise reste séparée, et le lecteur convertit les dollars comme il le fait déjà, au taux de l'ADR 0033.
- Une ligne en quarantaine (modèle non relié) ne compte pour aucune créatrice et ne sonne pas. Le propriétaire en voit seulement le nombre.
- **Chiffre d'affaires** : le brut TTC payé par les fans, moins les remboursements. C'est le `revenueTtc` de Reveal. Le terme entre au glossaire, avec « Bilan du soir ».

## Lots

### Lot a : publier les ventes et leurs totaux (`connectors`, `contracts` ; Bilan relit)

- [x] `sale_detected` est publié dans la transaction qui insère une ligne `sale_created` dans le registre, et seulement à sa première insertion. Un webhook rejoué ou une page relue n'insère rien, donc ne publie rien. Une ligne sortie de quarantaine ne sonne pas : elle entre dans les totaux.
- [x] Il ne sonne que si la vente a moins de 15 minutes à son insertion (`SALE_RING_WINDOW_MS`, réglé dans le code, jamais par un utilisateur). Une vente plus ancienne compte dans les totaux et le bilan du soir sans sonner (Bilan).
- [x] Le payload de `sale_detected` est redéfini, puisque rien ne le publie encore. Il contient la plateforme, le compte, la clé de la vente, l'instant, le type, la devise, le brut TTC, le net, les deux parts, et le vendeur (`member` avec son `memberId`, `agent`, `unlinked` ou `none`). Il ne contient jamais le fan, ni son identifiant, ni son pseudo.
- [x] `salesTotals` et `salesFeedTotals.totalsOf`, avec leur contrat Zod (`SalesTotalsSchema`, `SaleSellerSchema`).
- [x] Aucune migration : l'index `platform_sales_creator_occurred_idx` et l'unicité (plateforme, vente, événement) suffisent (Bilan).

### Lot b : Telegram (`telegram` ; le fil Telegram relit, Extension pour l'onglet)

- [x] Alerte de vente dans le sujet « Ventes ». Son montant est le prix payé par le fan (TTC), celui que l'équipe voit dans Reveal (question 2). Exemple inventé : « Vente · Nora · PPV · 45,00 € · vendue par Théo », ou « … · vendue par l'agent », « … · chatteur non relié », ou « … · sans chatteur ». Jamais un fan. Lot b1 : toutes les ventes sonnent tant que les réglages n'existent pas ; une ligne de l'outbox illisible fait avancer le curseur du scan.
- [x] Réglages des ventes (P3-07), par créatrice ou pour toutes : un montant minimum sur ce même prix (question 2), « ventes de l'agent seulement » ou « toutes », et le bilan du soir allumé ou non. Lot b2 : `telegram_settings` n'existait pas, créée par la migration 0083 (0080 attribuée par Bilan, renumérotée après la fusion de 0082) ; `GET`/`PUT /v1/settings/telegram/sales`, propriétaire seul, `audit_log` à chaque enregistrement.
- [x] Bilan du soir à 23 h, dans le fuseau de la créatrice, envoyé aux groupes du sujet « Ventes ». Pour chaque créatrice : le chiffre d'affaires, le net, les deux parts, le nombre de ventes et de remboursements, puis le détail par chatteur (son nom), l'agent et « sans chatteur », puis les remboursements faits ce jour de ventes d'avant (lecture `refundsOf` de Bilan, #462). Rien sans registre relié ; un registre non lu depuis plus d'une heure le dit, sans donner « Aucune vente » (`readingsOf`, ADR 0054). Le job `telegram.evening_digest` est branché dans le crontab par Bilan, dans ce lot.
- [x] L'onglet Ventes de Réglages › Telegram passe de « bientôt » aux vrais réglages, avec la phrase « réserve-le à toi et aux managers » (ADR 0043 § 7, remarque d'Équipe). Captures Nuit et Jour, 390 et 1440 : `/mnt/project-files/reglages-ventes/crm-04/b2/`.
- [x] Un remboursement ne sonne pas en direct : il apparaît au bilan du soir et dans les totaux (question 2).
- Lot b3, côté Telegram, reste à faire : le rendu de l'alerte « important » au propriétaire (question 6) ; à l'origine : une alerte « important » au propriétaire (question 6) quand la dernière vérification CRM-02 d'une plateforme ne concorde plus alors qu'un compte y est déjà en `detected`. Elle ne change aucun montant.
- [x] Lot b3 (Bilan, migration 0092) : le job `connector.check_sales`, les 2 et 17 à 6 h UTC, compare le net du registre aux statistiques de la plateforme sur la quinzaine qui vient de finir, pour les comptes en `detected` sur toute la quinzaine (règles écrites avant elle). Un écart est revu 24 h après ; s'il tient, l'événement `sales_feed_mismatch` est publié une seule fois par plateforme et quinzaine (index unique), sans créatrice, ni fan, ni chatteur. Rien n'est écrit dans `sales_feed_checks`, aucune règle ne bascule, et la paie ne le lit pas (test). Reste au fil Telegram : le rendu de l'alerte.

### Lot c : le Dashboard (`supervision` ; le fil Agent relit, Extension pour l'écran)

- Le panneau des ventes lit `salesFeedTotals` dès que la créatrice a un compte Reveal relié au registre. Sans ce compte, il garde la lecture actuelle.
- Le propriétaire et un manager actif voient le détail par chatteur, l'agent, « chatteur non relié » et « sans chatteur ». Un chatteur ne voit jamais les chiffres d'un autre (ADR 0043 § 7).
- Aucun montant de paie n'est lu ni changé.

### Lot d : la créatrice (avec CR-02 et CR-04 ; Bilan relit la base, Extension les écrans)

- [x] Lot d1, la base (migration 0085, numéro de Bilan) : la vue `creator_sales` et les fermetures décrites plus bas (« La base dit la même chose que l'écran »), plus le lecteur `creatorSalesReads.salesOf` de `connectors`, que la route de CR-04 lira dans `withCreatorAccount`. Il applique la règle des jours des totaux, sans vendeur, sous un contrat Zod strict (`CreatorSalesSchema`) : un champ du vendeur ou du fan chez la plateforme le fait échouer.
- [x] Lot d2, la notification par vente : le job `notifications.creator_sale`, mis en file par le registre dans la transaction qui publie `sale_detected` (dessin accepté par Bilan et Chantier 7 le 03/11). Il lit sa part et sa devise dans l'événement, jamais le vendeur, et prévient ses comptes une fois par vente, sous les règles de CR-01, avec un lien vers `/ventes`.
- Lot d3, le signal d'écart, qui attend le pourcentage de l'agence de CR-04.
- Sur un compte Reveal dont le modèle est relié, basculé ou non, `modelRevenue` est « Ta part », même sans pourcentage réglé, et l'écran dit « lus chez Reveal » (ADR 0050 § 8, ADR 0054, question 4). Le parcours ne prend que des chiffres de Reveal, sans aucun calcul dans le navigateur : ce que les fans ont payé, puis la TVA, puis Reveal (commission et frais), puis l'agence, puis toi.
- [x] Une notification par vente (ADR 0042 § 7), qui suit les règles de CR-01. Elle est idempotente sur la clé de la vente (`objectKey`). Elle montre sa part, jamais le chatteur ni l'agent. Exemple inventé : « Nouvelle vente · 12,40 € pour toi » (question 3).
- Un écart entre `modelRevenue` et le pourcentage réglé se signale au propriétaire, à titre d'information (ADR 0050 § 8), quand l'écart dépasse un centime par vente sur un compte et une quinzaine (question 5). Il ne change aucun montant.

## Ce que la créatrice voit, et ne voit jamais

**Elle voit**, en lecture seule, sur ses comptes seulement :
- ses ventes : l'heure, le type (PPV, pourboire, abonnement…), le montant payé par le fan, sa part, et « remboursée » s'il y a lieu ;
- le fan, mais seulement quand Nirvana le connaît déjà par sa fiche. L'API ne donne qu'un pseudo, que nous ne gardons pas (ADR 0050 § 4) ;
- ses totaux sur Aujourd'hui, la quinzaine et le mois, « estimés » tant que la période n'est pas close (ADR 0042 § 6).

**Elle ne voit jamais** :
- l'agent ni l'IA, sous aucune forme : ni « vendue par l'agent », ni une ligne ou un nombre de ventes de l'agent, ni une différence entre ses ventes qui le laisserait deviner (ADR 0021, ADR 0042 § 2) ;
- qui a vendu (question 1) ;
- les montants d'un chatteur, une commission, la paie, la part de l'équipe, un signalement, une vente en attente, une vérification CRM-02, les réglages ou les alertes Telegram.

**La base dit la même chose que l'écran** (ADR 0042 § 2) :
- La créatrice lit par le chemin de CR-02, qui pose son rôle et son `creator_id` côté serveur, jamais d'après la requête.
- `platform_sales` porte `platform_chatter_id` et `platform_fan_id`, et sa politique ne filtre aujourd'hui que par créatrice. Moyen choisi par Bilan, dans une seule migration du lot d (0085, fusionnée après 0082 de CR-02) :
  - une politique restrictive sur `platform_sales`, `current_setting('app.account_role', true) is distinct from 'creator'`, pour tout (`closedToCreator()`, comme `drafts`) : elle n'y écrit pas non plus ;
  - une vue `creator_sales` en `security_barrier`, sans `platform_chatter_id` ni `platform_fan_id` ni rien qui désigne le vendeur, accordée en SELECT à `nirvana_app`. Elle porte son propre filtre, `creator_id = nullif(current_setting('app.creator_id', true), '')::uuid and current_setting('app.account_role', true) = 'creator'` (propriétaire `nirvana_admin` BYPASSRLS, sans `security_invoker`) ;
  - la même politique restrictive sur `domain_events`, en SELECT seulement (`hiddenFromCreator()`), qui n'est aujourd'hui fermé que par créatrice (`tenant_isolation` de 0000) : le chemin de CR-02 lirait sinon chaque `sale_detected` et son `memberId`. Une écriture de la créatrice peut toujours y publier son événement ;
  - ajouté au lot d1 : la RLS, avec une seule politique permissive pour tout autre chemin (`agencyOnly()`), sur les tables d'agence du registre où figurent un chatteur, un fan chez la plateforme ou un membre, `platform_sales_quarantine`, `sales_feed_chatters` et `sales_feed_checks`. Sans elle, le chemin de la créatrice, qui tourne sous `nirvana_app`, les lirait entières.
- La route de la créatrice ne lit que sa vue et n'importe rien d'autre de `connectors`.
- Le fan, tranché par Bilan (03/11) : la vue fait `left join fans f on f.creator_id = l.creator_id and f.platform_account_id = l.platform_account_id and f.platform_fan_id = l.platform_fan_id` et ne rend que `f.id as fan_id`, qui peut être nul ; ni `platform_fan_id` ni pseudo. La condition sur `f.creator_id` est obligatoire, puisque le propriétaire de la vue contourne la RLS de `fans`. L'unique (`platform_account_id`, `platform_fan_id`) de `fans` sert d'index. L'écran lit le nom par sa lecture habituelle des fiches, sur le même chemin RLS que CR-04. Sans fiche, ou sans compte relié, `fan_id` est nul et l'écran dit « un fan ».
- Test de la migration : la vue n'a aucune colonne `platform_fan_id` ; la fiche d'une autre créatrice n'est jamais jointe ; `fan_id` est nul sans fiche.
- Un test d'intégration RLS prouve chacun de ces points (la vue ne rend rien hors du chemin de la créatrice ni pour une autre créatrice ; la table et `domain_events` ne rendent rien au chemin de la créatrice), et un test d'écran prouve qu'aucun texte de ses écrans ne nomme l'agent.

## Routes

- `connectors` : aucune route nouvelle. Le lot a ne donne qu'un port.
- `telegram` : les réglages des ventes, sur le modèle des routes de Réglages › Telegram (propriétaire seul, ré-authentification comme les autres réglages).
- `supervision` : `GET /v1/dashboard`, dont seule la forme du panneau des ventes change.
- Créatrice : la route de CR-04 (`GET /v1/me/earnings?period=`), qui lit la vue du lot d.

## Questions pour Charles (argent et règles)

Posées à Charles le 03/11 avec ces recommandations, toutes acceptées par lui le 03/11/2026 à 09h32 (« ok recos »). La 4 change une phrase de l'ADR 0042 § 6 : c'est l'ADR 0054.

1. **Qui a vendu, chez la créatrice ?** CR-04 dit « qui a vendu ». Mais montrer le chatteur, c'est laisser deviner les ventes de l'agent, qui n'en ont pas. Reco : ne rien montrer, comme pour l'auteur d'un message (ADR 0042 § 2), et retirer « qui a vendu » de CR-04.
2. **Montant d'une alerte Telegram, et son minimum.** Reco : le prix payé par le fan (TTC), celui que l'équipe voit dans Reveal, avec le minimum sur ce prix. Un remboursement ne sonne pas en direct ; il apparaît au bilan du soir et dans les totaux.
3. **Montant de la notification de la créatrice.** Reco : sa part, « Nouvelle vente · 12,40 € pour toi ».
4. **Avant la bascule d'un compte Reveal**, la créatrice voit-elle déjà les chiffres de Reveal ? L'ADR 0042 § 6 lie ses gains à la source de la paie. Or, sur Reveal non basculé, aucune vente n'est saisie une à une (CR-03 bloquée), et son écran resterait vide. Reco : oui, dès que le modèle est relié, avec la mention « lus chez Reveal ». Charles l'a dit : « c'est le plus fiable ». Il faut une phrase d'amendement à l'ADR 0042 § 6, à écrire avec son « ok ».
5. **Écart entre `modelRevenue` et le pourcentage réglé.** Reco : le signaler au propriétaire quand, sur un compte et une quinzaine, l'écart dépasse ce que l'arrondi explique, soit un centime par vente. C'est une information, qui ne change aucun montant.
6. **Alerte après la bascule** : prévenir le propriétaire quand la dernière vérification d'une plateforme ne concorde plus alors qu'un compte y est en `detected` ? Reco : oui, en « important », sans toucher à la paie.

## Critères d'acceptation

- Une vente rejouée ne sonne qu'une fois (intégration ; la livraison d'un webhook ne fait que réveiller la lecture par curseur, CRM-01, donc rejouer le curseur couvre les deux chemins). Lot a.
- Les totaux d'un mois égalent `/v1/stats/daily`, au centime, pour `revenueTtc`, `revenueHt`, `agencyRevenue` et `modelRevenue` (test contre FakeReveal). Lot a.
- Une ligne en quarantaine ne compte pour aucune créatrice et ne sonne pas, ni quand elle en sort (test). Lot a.
- La créatrice ne lit que ses lignes, jamais `platform_chatter_id`, `platform_fan_id` ni un `sale_detected` (intégration RLS). Aucun de ses écrans ne nomme l'agent (test d'écran).
- Un chatteur ne voit pas les chiffres d'un autre (test). Ni une alerte ni le bilan du soir ne contiennent un fan (test).
- Aucun de ces chiffres ne change la paie (test).
- Captures Nuit et Jour, téléphone et bureau, pour chaque écran.

## Hors périmètre

- Le nom du pack et l'entonnoir par bundle (ils demandent la capture).
- Les signaux de CRM-05 (vente hors shift, écart d'assignation, performance).
- Tout malus, et la facturation de la créatrice.
- Les ventes en attente côté chatteur, qui demandent la projection du recalcul notée en CRM-03.

## Notes de session

- 03/11, Équipe, lot a : règle des jours extraite de la vérification (`domain/sale-days.ts`), `salesTotals` et `salesFeedTotals.totalsOf`, `sale_detected` publié par `recordPage` dans la fenêtre de 15 minutes, contrats `SaleSellerSchema`, `SalesTotalsSchema` et payload de `sale_detected`. Reste : lots b, c et d, après les réponses de Charles.
- 03/11, Charles : « ok recos », les six recommandations acceptées. Lot b au fil Telegram, lot c au fil Agent, retrait de « qui a vendu » de CR-04 au fil Chantier 7 ; ADR 0054 pour la question 4 ; lot d à Équipe après CR-02 et CR-04.
- 03/11, Bilan, lot b3 : `connector.check_sales` et `sales_feed_mismatch` (migration 0092) ; les comptes vérifiés viennent de `salesCheckReads` du module `scheduling` (relecture Équipe). Le rendu Telegram reste au fil Telegram.
- 03/11, Agent, lot c : section « Ventes lues chez » la plateforme sur le Dashboard (`revealSalesPanel`, lecteur sous `withTenantMember`, contrat `revealSales`), quatre sortes de vendeur pour le propriétaire et un manager actif, rien pour une lecture de portée « soi » ni pour la créatrice. Les alertes des questions 5 et 6 restent aux lots d et b.
- 03/11, Équipe, lot d1 : migration 0085 (vue `creator_sales`, `platform_sales` fermée à la créatrice, `domain_events` cachée, RLS `agencyOnly` sur la quarantaine, les liens de chatteurs et les rapports de vérification), lecteur `creatorSalesReads.salesOf` et contrat strict `CreatorSalesSchema`. Tests : intégration RLS (`creator-sales-rls.integration.test.ts`), décisions par table de CR-02 mises à jour, intégration de bout en bout contre FakeReveal (sa part égale les statistiques de Reveal au centime, sans vendeur, le fan par sa fiche, rien pour l'agence ni pour l'admin), unitaires de la règle. Reste : d2 (notification), d3 (écart, après le pourcentage de CR-04), et la route et l'écran de CR-04.
- 03/11, Équipe, lot d2 : job `notifications.creator_sale` (`{ eventId }`, clé `notifications.creator_sale:<ligne>`, `preserve_run_at`), mis en file par `sales-ledger.ts` à côté de `sale_detected`. Le module `notifications` relit l'événement par le rôle admin (`.pick` de la clé, de sa part et de la devise), trouve ses comptes (rôle `creator`, `creator_ids` = sa créatrice) et le fuseau de sa créatrice, puis appelle `notify` (motif `sale`, objet = la ligne). Message : « Nouvelle vente », « 12,40 € pour toi », lien `/ventes`. Tests : unitaires du message et du job ; intégration contre FakeReveal (un job par vente fraîche, aucun pour une relecture, une vente tardive, un remboursement ou une sortie de quarantaine ; ses comptes seuls prévenus, une fois, la quatrième vente en deux minutes groupée). Reste : d3, et la route et l'écran de CR-04.
