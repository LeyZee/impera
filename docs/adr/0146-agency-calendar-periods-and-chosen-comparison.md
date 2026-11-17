# 0146. Le Dashboard de l'agence se lit par jour, semaine, mois ou période choisie, et se compare à la période qu'on choisit

Statut : accepted (acceptée par Charles le 17/11/2026, 13 h 58, après validation des captures du lot dashboard-periodes-4 ; demande de Charles du 16/11/2026, 23 h 45, fil « Aligner le dashboard sur Reveal » : « plutôt que de mettre aujourd'hui, 7 jours, 30 jours, 3 mois, Reveal met jour, semaine, mois, et après tu peux personnaliser […] et tu peux choisir le mois auquel tu veux confronter » ; numéro attribué par le coordinateur le 16/11, 23 h 49)
Date : 2026-11-16
Précise : ADR 0078 § 3 (les périodes) et § 5 (la route). Ne touche ni aux montants (0078 § 2, 0106), ni aux abonnés (0081), ni au bloc de l'agent d'une créatrice.

## Contexte

« L'agence en chiffres » propose quatre périodes glissantes : aujourd'hui, 7, 30 et 90 jours, chacune comparée aux jours d'avant de même longueur. Reveal raisonne en calendrier : un jour, une semaine, un mois civil, avec des flèches pour passer au précédent, une période personnalisée et un choix de la période de comparaison (« vs mois précédent », ou un autre mois).

Le 16/11, Charles a comparé les deux écrans et n'a pas retrouvé les mêmes chiffres. Une grande part de l'écart vient de là : Reveal montrait novembre (du 1er au 16), Impera les 90 derniers jours, qui contiennent la fin d'octobre. Tant que les deux écrans ne parlent pas des mêmes jours, aucun chiffre ne peut se vérifier d'un coup d'œil.

Deux défauts de la courbe sous le chiffre d'affaires viennent aussi de la période glissante : sur 90 jours, alors que le registre n'a que quelques semaines, la courbe reste plate puis se tasse à droite ; et l'écran dit « rien à comparer » ou une hausse fausse quand la période d'avant tombe avant le registre.

## Décision

### 1. Quatre façons de choisir les jours

- **Jour** : un jour de la plateforme (heure de Paris pour Reveal), aujourd'hui par défaut.
- **Semaine** : du lundi au dimanche, la semaine en cours par défaut.
- **Mois** : un mois civil, le mois en cours par défaut. C'est le choix à l'ouverture de l'écran, comme chez Reveal.
- **Personnalisé** : du premier au dernier jour choisis, 366 jours au plus.

Des flèches passent à la période d'avant ou d'après, de la même sorte ; la flèche d'après s'éteint sur la période en cours. Un jour à venir n'est jamais lu.

### 2. Une période en cours est coupée à aujourd'hui, sa comparaison aussi

Une semaine ou un mois pas fini est lu jusqu'à aujourd'hui compris (« 1er–16 nov. »). Sa comparaison est coupée au même nombre de jours (« 1er–16 oct. ») : comparer seize jours à un mois entier ferait croire à une baisse qui n'en est pas une. L'écran écrit toujours les jours comparés. Le jour d'aujourd'hui se compare à un jour entier, comme avant : les sommes du registre sont par jour, pas par heure.

### 3. La comparaison se choisit

Par défaut, la période de même sorte juste avant (hier, la semaine d'avant, le mois d'avant ; pour une période personnalisée, autant de jours juste avant). On peut en choisir une autre de même sorte : un autre jour (par exemple le même jour la semaine d'avant), une autre semaine, un autre mois (par exemple le même mois l'an dernier), ou, pour une période personnalisée, un autre premier jour, la longueur restant la même. La comparaison finit toujours avant la période lue. Elle sert à chaque pourcentage de l'écran, aux fans d'avant et aux abonnés d'avant, avec les mêmes règles qu'aujourd'hui.

### 4. Ce que le registre ne couvre pas n'est pas comparé

La réponse donne le premier jour du registre des créatrices comptées (sa plus vieille ligne). Si la comparaison commence avant ce jour, l'écran n'affiche aucun pourcentage d'argent ni de fans : il écrit « le registre commence le … » au lieu d'une hausse fausse. C'est la règle que les abonnés suivent déjà (ADR 0081 § 4). Les montants eux-mêmes ne changent pas.

### 5. La courbe du chiffre d'affaires

Sous le chiffre d'affaires, une courbe jour par jour, avec la comparaison en trait discret derrière, alignée jour pour jour. Au survol, au focus ou au toucher, une bulle donne la date et le montant du jour, et celui du jour comparé. La courbe commence au premier jour du registre quand il tombe dans la période : elle ne se tasse plus à droite. Les couleurs restent celles d'Impera ; la forme s'inspire de Reveal sans la copier.

### 6. La route

`GET /v1/dashboard/agency` reçoit l'une ou l'autre forme :
- `unit=day|week|month` et `at` (un jour de la période voulue, aujourd'hui par défaut), ou `unit=custom` avec `from` et `to` ;
- `compareAt` en option : un jour de la période de comparaison voulue (pour `custom`, son premier jour).

Le serveur fixe les jours, dans le fuseau de la plateforme : le code tient la règle, pas l'écran. L'ancienne forme `period=day|week|month|quarter` (jours glissants) reste servie telle quelle, pour l'outil `stats_get` du MCP et les liens déjà partagés. La réponse dit la sorte de période, si elle est coupée à aujourd'hui, aujourd'hui, le premier jour du registre et le chiffre d'affaires de chaque jour de la comparaison. Aucun fan, aucune nouvelle donnée : seulement d'autres jours des mêmes sommes.

## Conséquences

Positives :
- Les chiffres du mois se comparent à ceux de Reveal sur les mêmes jours, au centime près hors différences de définition (voir plus bas).
- Une hausse ou une baisse se lit sur des jours comparables, choisis par le propriétaire.
- Aucune table, aucune migration, aucun appel de plus à Reveal.

Négatives, à surveiller :
- Une période personnalisée d'un an lit beaucoup de lignes, créatrice par créatrice. Si la lecture devient lente, des sommes quotidiennes en table viendront par une ADR (déjà prévu par 0078).
- Le premier jour du registre est sa plus vieille ligne, pas le jour où la lecture a commencé : une créatrice sans vente pendant ses premiers jours paraît avoir un registre plus court.

Différences de définition avec Reveal, qui restent et que l'écran dit dans ses bulles :
- Reveal compte chaque abonnement gratuit comme une vente ; Impera compte une ligne d'argent par vente. Le nombre de ventes et le panier moyen diffèrent donc.
- Reveal recalcule ses statistiques chaque heure, chaque vue à son heure ; Impera lit le registre chaque minute.

## Alternatives rejetées

- **Garder les périodes glissantes et ajouter « mois en cours »** : deux logiques côte à côte, et toujours pas de comparaison choisie.
- **Comparer une période en cours à la période d'avant entière, comme Reveal** : au milieu du mois, tout paraît en baisse de moitié.
- **Calculer les jours dans le navigateur** : la règle des périodes vivrait dans l'écran, et le MCP ne la partagerait pas.
