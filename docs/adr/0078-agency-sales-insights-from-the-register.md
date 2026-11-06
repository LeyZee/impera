# 0078. Le Dashboard de l'agence lit ses insights dans le registre des ventes, pour le propriétaire et un manager actif

Statut : proposed (demande de Charles du 06/11/2026, 19 h 25 ; proposition acceptée par « ok dashboard-insights », 19 h 31 ; numéro attribué par le coordinateur le même soir)
Date : 2026-11-06
Précise : l'ADR 0050 (registre des ventes d'une plateforme, § 8 : montants de la plateforme, jamais recalculés) et l'ADR 0043 § 7 (un chatteur ne voit jamais les chiffres d'un autre). Ne remplace rien.

## Contexte

Le 06/11 à 19 h 25, Charles a écrit que le Dashboard « manque vraiment d'insight ». Il veut reprendre les indicateurs du dashboard de Reveal, avec de jolis graphiques et donuts, pour suivre l'activité de l'agence et guider la stratégie des plateformes et des ventes. Le Dashboard actuel (maquette v6 du 17/10) est l'écran d'une seule créatrice et de son agent IA. Il ne dit rien de l'agence entière.

Le registre `platform_sales` (ADR 0050) garde chaque vente et chaque remboursement des comptes reliés, avec :
- son heure ;
- sa créatrice ;
- son type ;
- le chatteur qui l'a faite ;
- l'identifiant du fan chez la plateforme ;
- les montants que la plateforme donne : TTC, net, part de l'agence, part de la créatrice.

`salesTotals` (CRM-04) en fait déjà la somme par jour, compte, type et vendeur, avec la règle qui redonne `/v1/stats/daily` au centime près.

Reveal donne aussi les abonnés, les PPV envoyés et les messages (`/v1/stats/daily`), mais rien de cela n'est gardé aujourd'hui. Le garder demande une table, un job et sa propre ADR (le « lot B »).

## Décision

1. **Qui le voit.** Le propriétaire, pour toutes les créatrices. Un manager actif, pour les créatrices de sa liste où sa portée est celle de l'équipe (ADR 0024). Personne d'autre : ni un chatteur, ni la créatrice elle-même, ni un opérateur sans fiche d'équipe. Si la portée d'un compte sur une créatrice est « la sienne », elle n'entre dans aucun chiffre : avec le total et sa propre part, il pourrait calculer celle des autres (ADR 0043 § 7). Un compte qui ne voit aucune créatrice avec la portée de l'équipe reçoit un refus (403).

2. **Une seule source : le registre local.** Les chiffres se lisent dans `platform_sales`. Les montants viennent de `salesTotals` : un remboursement est retiré du jour de sa vente, chaque jour est celui de la plateforme. L'écran n'appelle jamais une plateforme. La part de l'agence est celle que la plateforme donne pour chaque vente, jamais un pourcentage écrit dans le code (ADR 0050 § 8). Les dollars sont convertis au dernier taux de la BCE que la paie connaît, comme ailleurs sur le Dashboard. Sans taux, ils sont laissés de côté, et la réponse le signale.

3. **Les périodes.** Quatre périodes : aujourd'hui, les 7 derniers jours, les 30 derniers jours ou les 90 derniers jours, aujourd'hui compris, en jours de la plateforme (heure de Paris pour Reveal). Chaque période se compare à celle de même longueur juste avant. Le bloc de l'agent d'une créatrice ne connaît pas 90 jours : il lit alors 30 jours et le dit dans sa ligne de lecture.

4. **Ce que la réponse porte, et rien d'autre.**
   - Les totaux de la période et de la précédente : chiffre d'affaires TTC, net, part de l'agence, part des créatrices, ventes, remboursements.
   - Le chiffre d'affaires de chaque jour, par créatrice et par type de vente.
   - Les sommes par type de vente. Les abonnements et leurs renouvellements forment un seul groupe.
   - Les sommes par vendeur : un membre sous son nom, l'agent, « non relié », personne.
   - Les sommes par créatrice.
   - Une carte jour de la semaine × heure, en heure de la plateforme, faite des ventes seules.
   - Le nombre de fans qui ont payé et le même nombre sur la période précédente, ceux dont c'est le premier achat dans le registre, la part du chiffre d'affaires faite par les dix fans qui ont le plus dépensé (en %, arrondie) et la dépense moyenne par fan payeur.

   L'identifiant, le pseudo ou le montant d'un fan ne quittent jamais le serveur. Un fan compte une fois par compte de créatrice, comme dans « Tes fans ».

5. **La route.** `GET /v1/dashboard/agency?period=&creatorId=` appartient au module `supervision`. Sans `creatorId`, elle couvre toute la portée du compte. Avec `creatorId`, elle couvre cette créatrice seule, avec la même règle de portée, et une créatrice hors de la liste du compte est refusée. La lecture se fait créatrice par créatrice, sous RLS (`withTenantMember`), une transaction après l'autre. Le contrat est un schéma Zod strict de `packages/contracts`. La route est couverte par le balayage d'isolation des tests.

6. **Hors écran tant que le lot B n'existe pas.** Les abonnés (actifs, nouveaux, désabonnements), le taux d'achat des PPV et les messages n'apparaissent pas du tout, même pas sous la forme d'une place marquée « bientôt ». Il n'y a ni prévision ni objectif.

## Conséquences

Positives :
- Le propriétaire voit l'agence entière sur un seul écran : d'où vient l'argent, qui vend, quand ça vend, et la dépendance aux plus gros fans.
- Aucune table, aucune migration, aucun appel de plus à Reveal. Les quotas de la clé ne bougent pas.
- Les chiffres concordent avec ceux de « Ventes lues chez Reveal » et avec le résumé du soir, parce qu'ils sortent de la même somme.

Négatives, à surveiller :
- Une lecture sur 90 jours et plusieurs créatrices parcourt beaucoup de lignes. S'il le faut, des sommes quotidiennes en table viendront par une ADR.
- Les « nouveaux payeurs » se jugent sur le registre, qui commence 31 jours avant la clé. Au début, presque tous les payeurs sont « nouveaux ».
- Sans le lot B, l'écran ne dit rien des abonnés. C'est ce qui manque le plus pour la stratégie d'abonnement.

## Alternatives rejetées

- **Lire `/v1/stats/daily` en direct à l'ouverture de l'écran** : le quota (20 par minute, 500 par jour pour l'agence) ne le permet pas, et un écran ne doit pas dépendre d'un tiers pour s'afficher.
- **Calculer dans le navigateur à partir des lignes** : il recevrait les fans un par un.
- **Une page « Stats » séparée** : le Dashboard est la première page qu'ouvre le propriétaire. C'est là qu'il doit trouver la stratégie (demande de Charles).
