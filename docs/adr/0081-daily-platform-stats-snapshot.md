# 0081. Les abonnés, les PPV envoyés et les messages se gardent en photo quotidienne lue chez la plateforme

Statut : accepted (« ok 0081 » de Charles le 07/11/2026, 13 h 50 ; « go » de Charles le 07/11/2026, 13 h 09, pour le lot B de DSH-01 ; numéro attribué par le coordinateur ; § 3, § 5 et § 6 précisés après la relecture de Bilan, 13 h 20 ; migration renumérotée 0138 par le coordinateur, 13 h 55)
Date : 2026-11-07
Précise : l'ADR 0078 § 6 (rien sur les abonnés tant que le lot B n'existe pas) et l'ADR 0050 (la clé d'agence lit la plateforme, le registre garde l'argent). Ne remplace rien.

## Contexte

Le Dashboard de l'agence (ADR 0078) lit tout dans le registre des ventes. Il ne dit rien des abonnés, du taux d'achat des PPV ni des messages, parce que le registre ne garde que des ventes. Charles veut piloter la stratégie d'abonnement, et c'est ce qui manque le plus à l'écran.

Reveal donne ces chiffres dans `GET /v1/stats/daily` : une ligne par modèle et par jour, jusqu'à 31 jours par appel, pour toutes les modèles de la clé. L'adaptateur sait déjà le lire (`dailyStats`, utilisé par la vérification de fiabilité de CRM-02). Ses règles :
- `newSubscribers` compte les gratuits et les payants, sans les renouvellements ;
- `unsubscribes` compte une échéance non renouvelée le jour de l'échéance, pas le jour du clic ;
- `activeSubscribers` est le nombre en fin de journée, et le nombre du moment pour aujourd'hui ;
- `ppvSent` compte les PPV privés et les fans visés par un Mass DM payant ; `ppvPurchased` comprend les Mass DM ;
- `messagesSent` (côté créatrice, hors Mass DM), `messagesReceived` et `ppvSent` sont recalculés tous les quarts d'heure, et valent `null` tant que l'historique n'est pas calculé, c'est-à-dire jusqu'à la nuit qui suit la création de la clé ;
- un jour passé peut encore changer : un remboursement retire la vente de son jour, et les compteurs se recalculent.

Le quota des statistiques est de 10 appels par minute par clé, et de 20 par minute et 500 par jour pour l'agence entière. Lire en direct à l'ouverture de l'écran est donc exclu (ADR 0078, alternatives).

## Décision

1. **Une photo par compte et par jour.** Une table `platform_daily_stats` garde, pour chaque compte de créatrice relié à une modèle de la plateforme et pour chaque jour de la plateforme : nouveaux abonnés, désabonnements, abonnés actifs, renouvellements, PPV envoyés, PPV achetés, messages envoyés, messages reçus, et l'heure de la lecture. Une ligne est réécrite à chaque lecture : c'est la dernière parole de la plateforme sur ce jour qui compte. Une valeur `null` reste `null` (« pas encore calculé »), jamais 0.

2. **Aucun montant.** La photo ne garde pas d'argent. Le chiffre d'affaires, le net et les parts restent dans le registre et dans `salesTotals` (ADR 0050 § 8, ADR 0078 § 2), pour qu'il n'y ait jamais deux vérités sur l'argent. Aucun fan, aucun chatteur : seulement des compteurs par compte et par jour.

3. **Quand on lit.** Un seul job `connector.read_daily_stats`, lancé toutes les heures, par plateforme connectée. Il choisit lui-même sa plage, dans le fuseau de la plateforme (`salesFeedTimeZone`, pas celui du serveur ni celui de l'agence) :
   - les 31 derniers jours s'il est 5 h chez la plateforme, ou si aucune lecture de 31 jours n'a réussi depuis la connexion de la clé ;
   - sinon, aujourd'hui et hier.

   Un seul appel lit toutes les modèles de la clé. La lecture « à la connexion » est donc un cas du même job, et une nuit manquée (worker arrêté) est rattrapée à l'heure suivante. Une modèle non reliée est ignorée : une fois reliée, la prochaine lecture de 31 jours remplit ses jours.

   **Le quota est gardé dans le code.** Chaque appel aux statistiques de la plateforme, par ce job comme par la vérification de CRM-02 (à la main ou automatique), est compté au jour de la plateforme, dans une table de comptage écrite avant l'appel. Le job ne lance pas d'appel s'il reste moins de 100 appels dans la journée sur les 500 de l'agence ; il le dit dans son journal et attend l'heure suivante. Le compte porte sur ce qui a été appelé, pas sur une estimation. Le besoin attendu est d'environ 25 appels par jour. Un 429 est une pause qui suit `Retry-After`, avec le même `pausedUntil` que la lecture des ventes, jamais une panne ; une clé refusée suit la règle déjà en place (« à reconnecter »).

4. **Ce que l'écran en montre.** Un bloc « Abonnés » dans le Dashboard de l'agence, pour l'agence entière ou une créatrice, avec les mêmes périodes et la même comparaison que l'ADR 0078 :
   - les abonnés actifs à la fin de la période et leur évolution depuis son début ;
   - les nouveaux abonnés, les désabonnements, le solde des deux, et les renouvellements ;
   - les abonnés actifs jour par jour ;
   - le taux d'achat des PPV (achetés sur envoyés), avec sa règle écrite à l'écran, car les Mass DM le font baisser ;
   - les messages envoyés et reçus.

   Le bloc dit l'heure de la dernière lecture. Un jour sans photo n'est pas un zéro : il est marqué « pas encore lu », et un compteur `null` est écrit « en calcul chez Reveal ». « Aujourd'hui » est le chiffre de la dernière lecture horaire.

5. **Qui lit, qui écrit.** La clé d'une ligne est (`platform_account_id`, jour de la plateforme), et la ligne porte sa créatrice. La table est en RLS `FORCE`, avec une politique écrite :
   - lecture : le propriétaire, toutes les lignes ; un manager actif, seulement les lignes des créatrices de sa liste où sa portée est celle de l'équipe (ADR 0078 § 1) ; personne d'autre, ni un chatteur, ni la créatrice, ni un opérateur ;
   - écriture : seulement le job, par `withAdmin`, jamais une route.

   L'écriture est idempotente : rejouer une lecture redonne la même table. La photo passe à l'écran par la route du Dashboard de l'agence (`GET /v1/dashboard/agency`), sous `withTenantMember`, sans appel à la plateforme ; la route reste déclarée au harnais d'isolation, et le test d'isolation couvre la nouvelle table. La migration est la 0138 ; elle crée la photo et la table de comptage des appels.

6. **Qui fait quoi** (comme l'ADR 0076 § 10). Bilan : le job, l'adaptateur, les deux tables, la migration 0138 et la lecture exposée par l'`index.ts` de `connectors`. Le fil du Dashboard : la route `GET /v1/dashboard/agency` et le bloc « Abonnés ». Extension : la relecture de l'écran et les captures.

## Conséquences

Positives :
- Le propriétaire voit enfin les abonnés gagnés et perdus, et peut juger une promotion ou un changement de prix.
- L'écran s'affiche sans dépendre de Reveal, et la clé garde l'essentiel de son quota.
- Le même job servira plus tard à d'autres plateformes : la photo parle de comptes et de jours, pas de Reveal.

Négatives, à surveiller :
- La photo a jusqu'à une heure de retard dans la journée, et un jour passé peut bouger jusqu'à la lecture de la nuit. L'écran le dit par l'heure de lecture.
- Avant la première nuit qui suit la connexion de la clé, les PPV envoyés et les messages sont « en calcul ».
- Les jours d'avant la clé moins 31 jours n'existent pas : les comparaisons longues commencent à vide.
- Une créatrice archivée sort de la lecture, comme dans l'ADR 0078.
- Un jour plus vieux que 31 jours qui change encore chez la plateforme (un remboursement tardif) n'est plus relu. C'est acceptable, puisque l'argent reste dans le registre.
- Un quota presque épuisé par des vérifications à la main laisse la photo en retard jusqu'au lendemain ; l'heure de lecture affichée le montre.

## Alternatives rejetées

- **Lire `/v1/stats/daily` à l'ouverture de l'écran** : le quota ne le permet pas, et l'écran dépendrait de Reveal.
- **Garder aussi les montants de la photo** : deux sources d'argent qui peuvent diverger d'un centime ; le registre suffit et la vérification de CRM-02 compare déjà les deux.
- **Recalculer les abonnés à partir des ventes d'abonnement** : un abonnement gratuit n'est pas une vente, et un désabonnement n'en laisse aucune trace.
