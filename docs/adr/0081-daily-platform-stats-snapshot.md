# 0081. Les abonnés, les PPV envoyés et les messages se gardent en photo quotidienne lue chez la plateforme

Statut : proposed (« go » de Charles le 07/11/2026, 13 h 09, pour le lot B de DSH-01 ; numéro attribué par le coordinateur)
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

3. **Quand on lit.** Un job `connector.read_daily_stats`, par plateforme connectée, un seul appel à chaque fois pour toutes les modèles :
   - toutes les heures, aujourd'hui et hier ;
   - chaque nuit à 5 h, heure de la plateforme, les 31 derniers jours, pour reprendre les jours recalculés et les compteurs qui valaient `null` ;
   - une fois à la connexion de la clé, les 31 derniers jours.

   Cela fait une trentaine d'appels par jour sur 500, en partage avec la vérification de CRM-02. Un 429 est une pause qui suit `Retry-After`, jamais une panne ; une clé refusée suit la règle déjà en place (« à reconnecter »). Une modèle non reliée est ignorée : une fois reliée, la lecture de la nuit remplit ses 31 derniers jours.

4. **Ce que l'écran en montre.** Un bloc « Abonnés » dans le Dashboard de l'agence, pour l'agence entière ou une créatrice, avec les mêmes périodes et la même comparaison que l'ADR 0078 :
   - les abonnés actifs à la fin de la période et leur évolution depuis son début ;
   - les nouveaux abonnés, les désabonnements, le solde des deux, et les renouvellements ;
   - les abonnés actifs jour par jour ;
   - le taux d'achat des PPV (achetés sur envoyés), avec sa règle écrite à l'écran, car les Mass DM le font baisser ;
   - les messages envoyés et reçus.

   Le bloc dit l'heure de la dernière lecture. Un jour sans photo n'est pas un zéro : il est marqué « pas encore lu », et un compteur `null` est écrit « en calcul chez Reveal ». « Aujourd'hui » est le chiffre de la dernière lecture horaire.

5. **Qui le voit.** Les mêmes que pour l'ADR 0078 § 1 : le propriétaire, et un manager actif pour les créatrices où sa portée est celle de l'équipe. La photo passe par la route du Dashboard de l'agence (`GET /v1/dashboard/agency`), sous RLS, sans nouvel appel à la plateforme.

6. **Sécurité de la table.** `platform_daily_stats` porte la créatrice, avec RLS en `FORCE` comme toute table nouvelle. Le job écrit en tant que service, ligne unique sur (compte, jour), écriture idempotente : rejouer une lecture redonne la même table. La migration est la 0137.

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

## Alternatives rejetées

- **Lire `/v1/stats/daily` à l'ouverture de l'écran** : le quota ne le permet pas, et l'écran dépendrait de Reveal.
- **Garder aussi les montants de la photo** : deux sources d'argent qui peuvent diverger d'un centime ; le registre suffit et la vérification de CRM-02 compare déjà les deux.
- **Recalculer les abonnés à partir des ventes d'abonnement** : un abonnement gratuit n'est pas une vente, et un désabonnement n'en laisse aucune trace.
