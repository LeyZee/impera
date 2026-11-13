# 0106. Le Dashboard de l'agence sépare le chiffre d'affaires, le net, la part de la créatrice et celle de l'agence, et estime la TVA des virements

Statut : accepted (« ok 0106 » de Charles le 13/11/2026, 0 h 52, fil « Afficher parts modèle, agence et TVA » ; numéro attribué par le coordinateur)
Date : 2026-11-13
Précise : l'ADR 0078 (insights de l'agence lus dans le registre des ventes) et l'ADR 0054 § 2 (sur Reveal, la part de la créatrice est le chiffre de Reveal). Ne remplace rien.

## Contexte

La tuile « Part de l'agence » divisait la part de l'agence par le chiffre d'affaires TTC. Le pourcentage convenu avec une créatrice se calcule, lui, sur le net (après la TVA payée par les fans et la commission de la plateforme). Le même montant paraissait donc bien plus petit que le pourcentage convenu, et la question « quel pourcentage afficher » s'est posée à la recette du 12/11.

Le 12/11/2026 à 23 h 45, Charles demande, comme sur Reveal, des tuiles séparées : chiffre d'affaires total, net, part de la créatrice, part de l'agence. Il veut aussi voir la TVA que Reveal ajoute à chaque virement. Ses réponses du 13/11 à 0 h 49 :

- Reveal calcule cette TVA sur la part de l'agence seule ; chaque créatrice reçoit la sienne sur sa propre part.
- Le taux est de 20 %.
- Le comptable la déclare comme TVA collectée, à reverser à l'État.
- Le montant exact figure sur le relevé de virement et sur les factures que Reveal établit lui-même.
- Une estimation automatique suffit : c'est une information, pas un montant de paie.

Ce que le registre a déjà, vente par vente (connecteur Reveal) : le TTC, le HT, le net, la part de l'agence et la part de la créatrice. L'API de Reveal n'a aucune route sur les virements : le montant exact de la TVA ajoutée n'est pas lisible.

## Décision

1. **Les montants restent ceux de Reveal.** Aucune tuile n'est recalculée avec le pourcentage saisi pour une créatrice ; ce pourcentage ne sert toujours qu'à signaler un écart (ADR 0054 § 2).
2. **Le contrat des chiffres porte le HT.** `AgencyFigures` gagne `revenueExclVatMinor`, somme des HT des ventes, remboursements déduits, comme les autres montants. Aucune migration : la colonne existe.
3. **Quatre tuiles d'argent, dans cet ordre** : chiffre d'affaires (ce que les fans ont payé, TTC), net, part de la créatrice, part de l'agence. Chacune avec son évolution sur la période d'avant.
4. **Les parts se disent en pourcentage du net**, jamais du chiffre d'affaires.
5. **Une carte « Où va l'argent »** montre le chiffre d'affaires en une barre partagée en quatre : TVA des fans (TTC moins HT), commission de la plateforme (HT moins net), part de la créatrice, part de l'agence. La TVA des fans n'est jamais présentée comme de l'argent de l'agence.
6. **La TVA des virements est une estimation, sur une tuile à part** : 20 % de la part de l'agence de la période, arrondi au centime, une demie loin de zéro. Elle n'est jamais additionnée à la part de l'agence ni à aucun autre montant, et sa note dit « estimation, à reverser à l'État ». Le montant exact reste celui du relevé de virement de Reveal.
7. **Le taux est une règle du code** (`AGENCY_TRANSFER_VAT_BPS = 2000`, le taux normal français), pas un réglage : il ne change que par une nouvelle ADR. Une part de l'agence nulle ou négative donne une TVA à zéro.
8. **Mêmes droits de lecture que l'ADR 0078** : le propriétaire et un manager actif, sur son périmètre ; une créatrice ne voit jamais ces tuiles.
9. **Calcul côté serveur**, dans le domaine `supervision`, livré par le contrat (`agencyTransferVatMinor`) : l'écran n'en refait aucun.

## Conséquences

Positives :

- Les chiffres se lisent comme sur Reveal, et la question du pourcentage affiché disparaît.
- Charles voit la TVA qui arrivera avec ses virements, sans la confondre avec son revenu.

Négatives, à surveiller :

- L'estimation peut différer du relevé de Reveal de quelques centimes (arrondi vente par vente chez Reveal, sur la période chez nous) ou davantage si la période ne coïncide pas avec celle d'un virement.
- Un changement de régime de TVA de l'agence (franchise, autre taux) demande une nouvelle ADR.
