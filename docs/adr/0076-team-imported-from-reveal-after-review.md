# 0076. L'équipe s'importe depuis Reveal par des suggestions confirmées, jamais en silence

Statut : proposed (demande de Charles du 06/11/2026, 17 h 45 : « ça pourrait détecter automatiquement tous les chatters actifs liés à l'agence » ; « ok détection chatteurs », « ok prestataires-lien-seul », « ok invitation-manager », 17 h 53)
Date : 2026-11-06
Précise : l'ADR 0050 § 5 (lien d'un chatteur Reveal à un membre), l'ADR 0023 (droits d'équipe), l'ADR 0024 § Rôles (« lui seul insère un taux », élargi au § 3 pour un manager, dans des bornes) et l'ADR 0069 (même démarche pour les créatrices). Ne remplace rien.

## Contexte

Quand la clé de l'API CRM est posée, le CRM lit déjà `/v1/chatters` (`listChatters`). Réglages › Ventes Reveal › Liens montre chaque compte de l'équipe Reveal avec ses étiquettes Bot, Externe et « Retiré le … ». Le propriétaire y choisit à la main un membre Impera, l'agent ou personne (`sales_feed_chatters`, `kind` `member` ou `agent`). La paie lit ce lien.

Ce qui manque :
- aucune proposition n'est faite, même quand l'e-mail du compte Reveal est celui d'un membre ;
- un chatteur qui n'existe pas encore dans Impera doit être créé à part, dans Équipe › Membres, puis relié ;
- un membre retiré sur Reveal mais encore actif chez Impera ne se signale pas.

Ce que `/v1/chatters` donne, sans pagination :
- `chatterId`, `firstName`, `lastName` ;
- `email` : l'e-mail de connexion pour un membre de l'agence, `null` pour l'équipe d'un prestataire de chatting ;
- `role` : un manager Reveal peut vendre ;
- `isBot` : les bots des clés d'API, celle d'Impera comprise ;
- `isExternal` : l'équipe d'un prestataire ;
- `removedAt` : un membre retiré, dont les ventes passées restent attribuées ;
- `modelIds` : ses modèles assignées.

L'API ne donne ni le pays, ni le fuseau, ni un taux, ni le contrat d'un chatteur.

## Décision

1. **Des suggestions, jamais un lien ni un membre posés seuls.** À chaque lecture de `/v1/chatters`, chaque compte sans lien reçoit une action proposée, que le propriétaire ou un manager actif confirme, ligne par ligne ou en lot. Le lot ne vaut que pour « Relier à », « L'agent » et « Personne » : une invitation se fait ligne par ligne (§ 3), parce qu'elle demande des champs et le mot de passe. Une ligne écartée ne revient pas ; elle reste dans la liste repliée « Écartés », d'où on peut la reprendre. Les actions proposées sont, dans cet ordre :
   - **Relier à** un membre Impera dont l'e-mail de compte est le même (sans casse) ;
   - sinon **Relier à** un membre dont le prénom et le nom correspondent (sans casse ni accents), proposé décoché quand deux membres correspondent ;
   - **L'agent** pour le compte Reveal du membre « bot », celui de la session capturée (ADR 0050 § 5) ; tant que ce compte n'est pas identifié par son `chatterId`, un compte nommé « bot » est proposé décoché ;
   - **Personne** pour un `isBot`, rangé dans la liste repliée ;
   - **Inviter** pour un membre de l'agence avec e-mail que rien ne rapproche.
2. **Les prestataires : un lien seulement** (« ok prestataires-lien-seul »). Un compte `isExternal` n'a pas d'e-mail et n'est pas de l'agence. Il n'est jamais invité depuis Reveal. On propose seulement « Relier à » un membre existant, ou « Personne ». **À valider par Charles (« ok prestataire-proprio ») :** relier un compte `isExternal` à un membre est réservé au propriétaire ; un manager peut seulement le mettre à « Personne ». Un tel lien fait payer une commission sur des ventes d'un prestataire déjà payé par son contrat, et grossit le net de l'équipe, donc la part d'un manager qui en a une.
3. **L'invitation depuis une suggestion** (« ok invitation-manager »). Le propriétaire et un manager actif peuvent inviter. C'est le même parcours que la création d'un membre : le compte sans mot de passe, la fiche, puis le lien d'invitation à partager (EQ-10). Rien ne part sans clic.
   - **Prérempli depuis Reveal** : le prénom, le nom, l'e-mail, le nom affiché (le prénom, modifiable), et le lien vers ce `chatterId`, posé dans la même transaction que la création. La route est dans `connectors`, la création dans `team` : `team` expose un port que la racine de composition branche sur une fonction de `connectors` qui pose le lien dans cette transaction.
   - **Saisi à l'écran** par celui qui invite : le pays, le fuseau et la date d'arrivée.
   - **Pour un manager, le rôle est toujours `chatter`.** Le `role` Reveal ne donne aucun droit chez Impera : un manager Reveal devient manager Impera seulement par le propriétaire, par la route du rôle.
   - **Pour un manager, le taux est un barème du propriétaire**, jamais un taux libre ni une part du net d'équipe. Le propriétaire garde tous les choix d'aujourd'hui.
   - **Les créatrices du chatteur.** Sans créatrice, il ne peut pas être planifié (`member_creator_conflict`). Le propriétaire choisit parmi toutes. **À valider par Charles (« ok créatrices-liste-manager ») :** un manager ne donne que des créatrices de sa propre liste, préremplies avec `modelIds` ∩ sa liste. C'est un droit d'accès aux conversations des fans. La liste du manager (`creator_ids`, hors RLS) est relue dans la transaction, et la vérification est dans le code, avec son test.
   - **Le lien d'invitation** : un manager obtient seulement le lien `invitation`, et seulement pour un chatteur dont le mot de passe n'est pas encore choisi. Le lien `reset` reste au propriétaire : il donne le compte d'un autre membre, avec ses commissions et ses accès.
   - **Dans la base, pas seulement dans la route.** Les politiques d'insertion réservées au scope `owner` s'élargissent au scope `agency` ainsi, et rien d'autre de l'ADR 0024 ne bouge (un taux changé après l'arrivée, un préréglage créé, un rôle changé restent au propriétaire) :
     - `team_members` et `member_roles` : seulement avec `team_role = 'chatter'` ;
     - `member_commission_rates` : seulement avec `preset_id` non nul, `team_share_bps` nul, `rate_bps` égal à celui du préréglage en vigueur pour son nom (sinon un ancien barème plus haut passerait), et `created_by` égal à soi ;
     - jamais par `withAdmin`.
   - Le mot de passe est redemandé pour inviter (`recentLogin`), comme pour l'import des créatrices (ADR 0069 § 6). L'invitation crée un compte qui ouvre l'accès à des conversations de fans ; c'est le geste le plus sensible de l'écran.
   - **Idempotent sur le `chatterId`.** Un verrou sur (plateforme, `chatterId`) ; le lien est lu en premier ; s'il pointe déjà vers un membre créé par cette invitation, la réponse est ce membre, pas un conflit. Un e-mail pris par un autre membre répond `member_conflict` sur sa ligne, sans faire tomber le lot.
4. **Garde contre soi-même.** Un manager ne peut ni confirmer, ni poser, ni changer un lien vers sa propre fiche : ce lien décide à qui vont des commissions. Seul le propriétaire le peut. Pour un manager, sa propre ligne reste visible, sans action. La garde est dans la base : l'écriture de `sales_feed_chatters` passe par `withMember`, qui pose le scope et `app.user_id`, et une politique restrictive sur INSERT, UPDATE et DELETE admet le scope `owner`, ou le scope `agency` quand ni l'ancienne ligne (USING) ni la nouvelle (WITH CHECK) ne pointent vers sa propre fiche ; sans l'ancienne ligne, un manager pourrait défaire ou déplacer un lien qui pointe vers lui. Chaque lien, chaque invitation et chaque ligne écartée vont au journal d'audit, avec l'identifiant Reveal et jamais un montant.
5. **Un retrait sur Reveal est une alerte, pas une suppression.** Un compte qui prend un `removedAt`, ou qui disparaît de la liste, alors que son membre Impera relié est actif, fait une alerte au propriétaire et aux managers actifs : « Retiré de Reveal le …, toujours actif chez Impera ». Rien n'est désactivé et le lien reste, puisque ses ventes passées restent attribuées. Le départ se fait par le parcours d'Équipe (ADR 0072).
   - C'est un état, pas un événement : une seule alerte par compte, affichée tant que la situation dure, jamais une par lecture.
   - Un compte « disparaît » seulement après une lecture complète réussie. Une liste vide, ou qui perd plus de la moitié de ses comptes d'un coup, fait une seule alerte « lecture Reveal anormale », pas une par membre.
   - « Actif » veut dire tout statut sauf `left` : un membre suspendu garde son compte.
   - L'alerte se ferme au départ du membre, au retrait du lien ou au retour du compte sur Reveal.
   - Où : une ligne ambre dans Liens et sur la fiche du membre, une pastille sur sa ligne d'Équipe › Membres, la carte « À traiter » du Dashboard et le compteur de Réglages. Pas de Telegram (comme l'ADR 0073), sauf demande de Charles.
   - Bilan garde ce que la lecture a vu (`removed_at`, compte absent) dans `sales_feed_chatters` et l'expose par l'`index.ts` de `connectors` ; Équipe l'affiche.
6. **Un nouveau venu fait un badge.** Un compte sans lien qui apparaît sur Reveal fait un badge « 1 nouveau chatteur sur Reveal » dans Réglages et dans Équipe › Membres, comme l'ADR 0069 § 5.
7. **`modelIds` est une information.** La ligne montre les modèles assignées sur Reveal à côté des créatrices du membre chez Impera, et signale l'écart. La route nomme chaque modèle : la créatrice Impera qui lui est reliée (ADR 0069), sinon « Modèle Reveal non importée » ; l'écran n'a rien à recalculer. Rien n'est réécrit : les créatrices d'un membre et ses accès en poste restent ceux d'Impera (ADR 0025).
8. **Droits et RLS.**
   - Le propriétaire et un manager actif lisent la liste et confirment les suggestions. Un chatteur et une créatrice n'y accèdent jamais.
   - La lecture garde la limite générale de Reveal (200 appels par minute) : aucun appel aux statistiques.
   - Aucune nouvelle table hors RLS. L'état « écarté » et ce que la lecture a vu tiennent dans `sales_feed_chatters` ou dans la migration du § 10.
9. **Données réelles.**
   - Rien de ce que renvoie `/v1/chatters` n'entre dans le dépôt, les fixtures ou les logs. L'e-mail sert à rapprocher, il n'est stocké que sur la fiche créée par une invitation.
   - `FakeReveal` gagne des chatteurs inventés couvrant chaque cas : e-mail connu, nom seul, homonymes, prestataire, bot de clé, membre « bot », retiré, nouveau venu, e-mail déjà pris.
10. **Propriété.**
    - Bilan : le schéma `/v1/chatters` (`email`, `role`), le calcul des suggestions, les routes, `FakeReveal`, ce que la lecture a vu (§ 5), la migration : la politique du § 4 sur `sales_feed_chatters` et l'élargissement des politiques d'équipe du § 3 (une migration, numéro attribué à l'arrivée sur `main`).
    - Équipe : l'invitation depuis une suggestion (port de `team`, bornes du § 3, lien `invitation`), les tests RLS « un manager contre lui-même » et « un manager hors de ses bornes », l'affichage de l'alerte de retrait.
    - Extension : l'écran, avec les captures Nuit et Jour, ordinateur et téléphone, avant fusion.

## Conséquences

- Avec la clé posée, l'équipe se monte en un écran : chaque compte Reveal est relié ou invité, et la paie attribue les ventes sans saisie.
- Un manager gagne un droit nouveau, inviter un chatteur, borné au rôle `chatter`, aux barèmes du propriétaire et, si Charles le valide, aux créatrices de sa liste. L'argent et les rôles restent au propriétaire, et les bornes sont tenues par la base.
- Le rapprochement par nom peut se tromper (homonymes, surnoms) : c'est pour cela que l'action n'est qu'une proposition.
- Un prestataire reste hors de l'équipe Impera : ses ventes vont à un membre relié, ou à personne, donc au valideur (ADR 0050 § 5).
- À vérifier au premier appel réel : que le membre « bot » remonte sous son propre `chatterId` (déjà noté à l'ADR 0050), et les valeurs réelles de `role`.

## Options écartées

- **Création automatique à la pose de la clé** : elle crée des comptes pour des bots, des prestataires et des membres retirés, et ouvre l'accès aux conversations sans que personne l'ait décidé.
- **Reprendre le rôle Reveal** : Reveal deviendrait une porte d'élévation de droits chez Impera.
- **Désactiver le membre retiré sur Reveal** : un retrait par erreur, ou un changement d'agence chez Reveal, couperait un chatteur en poste et toucherait sa paie.
- **Invitation réservée au propriétaire** : c'était la recommandation de Bilan ; Charles a choisi d'y ajouter le manager, avec les bornes du § 3 et du § 4.
