# CRM-04 Ventes en direct : alertes, chiffre d'affaires et gains de la créatrice

Statut : in_progress. Lot a en PR (03/11/2026) ; les lots b à d attendent les réponses de Charles aux six questions d'argent et de règle (fin de fiche), posées le 03/11 (ADR 0050, fiche acceptée par Charles le 02/11/2026, détaillée par Équipe et relue par Bilan le 03/11).
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

- Alerte de vente dans le sujet « Ventes ». Exemple inventé : « Vente · Nora · PPV · 45,00 € · vendue par Théo », ou « … · vendue par l'agent », « … · chatteur non relié », ou « … · sans chatteur ». Jamais un fan.
- Réglages des ventes (P3-07), par créatrice ou pour toutes, dans `telegram_settings` qui existe déjà : un montant minimum (question 2), « ventes de l'agent seulement » ou « toutes », et le bilan du soir allumé ou non.
- Bilan du soir à 23 h, dans le fuseau de la créatrice, envoyé aux groupes du sujet « Ventes ». Pour chaque créatrice : le chiffre d'affaires, le net, les deux parts, le nombre de ventes et de remboursements, puis le détail par chatteur (son nom), l'agent et « sans chatteur ». Le job `telegram.evening_digest` est branché dans le crontab par Bilan, dans ce lot.
- L'onglet Ventes de Réglages › Telegram passe de « bientôt » aux vrais réglages.
- Proposé, à confirmer par Charles (question 6) : une alerte « important » au propriétaire quand la dernière vérification CRM-02 d'une plateforme ne concorde plus alors qu'un compte y est déjà en `detected`. Elle ne change aucun montant.

### Lot c : le Dashboard (`supervision` ; le fil Agent relit, Extension pour l'écran)

- Le panneau des ventes lit `salesFeedTotals` dès que la créatrice a un compte Reveal relié au registre. Sans ce compte, il garde la lecture actuelle.
- Le propriétaire et un manager actif voient le détail par chatteur, l'agent, « chatteur non relié » et « sans chatteur ». Un chatteur ne voit jamais les chiffres d'un autre (ADR 0043 § 7).
- Aucun montant de paie n'est lu ni changé.

### Lot d : la créatrice (avec CR-02 et CR-04 ; Bilan relit la base, Extension les écrans)

- Sur un compte Reveal basculé, `modelRevenue` est « Ta part » (ADR 0050 § 8). Le parcours ne prend que des chiffres de Reveal, sans aucun calcul dans le navigateur : ce que les fans ont payé, puis la TVA, puis Reveal (commission et frais), puis l'agence, puis toi.
- Une notification par vente (ADR 0042 § 7), qui suit les règles de CR-01. Elle est idempotente sur la clé de la vente (`objectKey`). Son texte est la question 3.
- Un écart entre `modelRevenue` et le pourcentage réglé se signale au propriétaire, à titre d'information (ADR 0050 § 8). La règle est la question 5.

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
- `platform_sales` porte `platform_chatter_id` et `platform_fan_id`, et sa politique ne filtre aujourd'hui que par créatrice. Moyen choisi par Bilan, dans une seule migration du lot d (numéro à reconfirmer, 0080 aujourd'hui) :
  - une politique SELECT restrictive sur `platform_sales`, `current_setting('app.account_role', true) is distinct from 'creator'` ;
  - une vue `creator_sales` en `security_barrier`, sans `platform_chatter_id` ni `platform_fan_id` ni rien qui désigne le vendeur, accordée en SELECT à `nirvana_app`. Elle porte son propre filtre, `creator_id = nullif(current_setting('app.creator_id', true), '')::uuid and current_setting('app.account_role', true) = 'creator'` (propriétaire `nirvana_admin` BYPASSRLS, sans `security_invoker`) ;
  - la même politique restrictive sur `domain_events`, qui n'est aujourd'hui fermé que par créatrice (`tenant_isolation` de 0000) : le chemin de CR-02 lirait sinon chaque `sale_detected` et son `memberId`.
- La route de la créatrice ne lit que sa vue et n'importe rien d'autre de `connectors`.
- Un test d'intégration RLS prouve chacun de ces points (la vue ne rend rien hors du chemin de la créatrice ni pour une autre créatrice ; la table et `domain_events` ne rendent rien au chemin de la créatrice), et un test d'écran prouve qu'aucun texte de ses écrans ne nomme l'agent.

## Routes

- `connectors` : aucune route nouvelle. Le lot a ne donne qu'un port.
- `telegram` : les réglages des ventes, sur le modèle des routes de Réglages › Telegram (propriétaire seul, ré-authentification comme les autres réglages).
- `supervision` : `GET /v1/dashboard`, dont seule la forme du panneau des ventes change.
- Créatrice : la route de CR-04 (`GET /v1/me/earnings?period=`), qui lit la vue du lot d.

## Questions pour Charles (argent et règles)

Posées à Charles le 03/11 avec ces recommandations. Aucune n'est appliquée sans son message, et rien des lots b à d qui en dépend ne se code avant.

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
- 03/11, Agent, lot c : section « Ventes lues chez Reveal » du Dashboard (`revealSalesPanel`, lecteur sous `withTenantMember`, contrat `revealSales`), quatre sortes de vendeur pour le propriétaire et un manager actif, totaux seuls pour un opérateur hors équipe, rien pour la créatrice. Les alertes des questions 5 et 6 restent aux lots d et b.
