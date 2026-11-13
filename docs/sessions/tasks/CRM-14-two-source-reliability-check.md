# CRM-14 Vérification de fiabilité sur deux sources : l'export devient facultatif

Statut : done (ADR 0050 § 8 amendé le 11/11/2026 : carte « Deux sources » et « ok phrases 0050 », Charles, 18 h 24)
Phase : API CRM (ADR 0050)
Dépend de : CRM-02
Branche : task/crm-14-two-source-check
Propriétaire proposé : Bilan

## Objectif

Le 11/11/2026, Charles a constaté que le dashboard de Reveal n'offre pas d'export. Or la vérification de fiabilité ne rendait `match` qu'avec un export : sans lui, le verdict restait « incomplet » et la garde de bascule refusait « Ventes relevées ». La vérification se fait désormais sur deux sources, le registre et `/v1/stats/daily` ; l'export reste comparé quand il est joint.

## Contexte à lire

ADR 0050 § 8 (amendé), ADR 0084, fiches CRM-02 et CRM-03.

## À faire

- [x] Amender l'ADR 0050 § 8 en place, avec la ligne de statut.
- [x] Domaine (`reliability-check.ts`) : `match` = statistiques lues, aucun écart, rien sans comparaison ; un export joint reste comparé et tout écart avec lui donne `mismatch` ; sans statistiques, `incomplete`.
- [x] Vérifier les autres exigences de l'export : `isCleanMatch`, la couche application, le corps Zod de la route (`export` déjà `nullable`), la garde de bascule de la paie (elle ne lit que `clean`) : aucune n'exigeait l'export en dehors du verdict.
- [x] Web : textes du verdict, de la note « statistiques indisponibles », du panneau (en-tête, aide du fichier, déjà « facultatif ») et de la raison `check_not_clean`.
- [x] Tests du domaine, de l'intégration et du web mis à jour ; docs de référence (glossaire, README de `connectors`, recette, fiches CRM-02 et CRM-03).

## Critères d'acceptation

- Un registre qui concorde avec les statistiques sur une quinzaine entière finie, sans export, donne un rapport propre.
- Un export joint qui diffère donne `mismatch`.
- Des statistiques illisibles donnent `incomplete`, avec ou sans export.
- Aucune migration, aucun montant de paie changé.

## Hors périmètre

- L'ADR 0084 (étape 4 : « avec l'export du dashboard Reveal ») et les mentions de l'historique au-delà de 31 jours par l'export (ADR 0050 conséquences, ADR 0069, CRM-07) : à amender avec l'accord de Charles.

## Résultat

11/11/2026 : verdict à deux sources, export facultatif partout où l'écran le demande. Reste : la ligne de l'ADR 0084 ci-dessus.
