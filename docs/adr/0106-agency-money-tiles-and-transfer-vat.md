# 0106. Le Dashboard de l'agence sépare le chiffre d'affaires, le net, la part de la créatrice et celle de l'agence, et estime la TVA des virements

Statut : accepted (« ok 0106 » de Charles le 13/11/2026, 0 h 52, fil « Afficher parts modèle, agence et TVA » ; numéro attribué par le coordinateur). Amendée : § 10 à § 14 (« ok phrases 0106 », 13/11/2026, 1 h 11, même fil), qui remplacent « une encre en quatre pas » du § 5. Avenant du 17/11/2026 au § 10 (part de l'agence au bleu du logo, courbes selon la tendance, barres des sortes de vente en cyan : décisions de Charles des 17 et 19/11/2026).
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

## Amendement du 13/11/2026 : couleurs et survols

À la recette du lot argent-tuiles-tva, Charles trouve que le Dashboard manque de repères par couleur et que « Où va l'argent » manque de survol avec des données précises.

10. **Chaque destination de l'argent a sa couleur, toujours la même partout sur le Dashboard** : TVA payée par les fans en gris (elle n'est à personne), commission de la plateforme en gris hachuré, part de la créatrice en rose (`--nv-money-creator`), part de l'agence en bleu (`--nv-money-agency` ; doré jusqu'à l'avenant du 17/11/2026).
11. **Où elles s'appliquent** : la barre « Où va l'argent », sa légende, et une pastille ronde à côté du titre des tuiles Part de l'agence et Part de la créatrice. Jamais de barre colorée sur le côté ; ni rouge ni ambre, réservés aux urgences et aux avertissements.
12. **Une bulle de survol** sur chaque bloc de la barre, chaque ligne de la légende et chaque tuile d'argent : le montant au centime, le montant de la période d'avant avec l'évolution, la part du chiffre d'affaires, la part du net pour les parts, et une phrase d'explication en gris. La TVA des virements, qui n'est pas une part du chiffre d'affaires, n'en donne pas la part.
13. **Au téléphone**, un appui ouvre la bulle et un second la ferme.
14. **Les couleurs sont vérifiées** par l'outil de contraste du projet (séparation pour les daltoniens, 3:1 sur la plaque), en Nuit comme en Jour, puis montrées sur un nouveau lot de captures avant la fusion.

## Avenant du 17/11/2026 : l'agence en bleu, les courbes selon la tendance

Le 17/11/2026 vers 13 h (heure de Paris), à la recette des périodes du Dashboard (ADR 0146), Charles veut plus de couleur et de courbes, « comme Reveal ». Ses choix : la part des créatrices reste rose (« ça fait féminin »), la part de l'agence passe au bleu, celui du logo d'Impera ; la courbe du chiffre d'affaires quitte le blanc.

1. **La part de l'agence est bleue** partout où le § 10 la place (`--nv-money-agency`, Nuit et Jour, validés par le fil Design au validateur dataviz). Le 19/11/2026, Charles a choisi le bleu exact de son logo : le marine #001A33 en Jour, tel quel, et en Nuit la même teinte (209°) éclaircie par le fil Design pour rester lisible sur la plaque sombre.
2. **La courbe du chiffre d'affaires prend la couleur de sa tendance** : verte (`--nv-trend-up`) au-dessus de la période comparée ou quand rien n'est comparable (ADR 0146 § 4), ambre (`--nv-trend-down`, la couleur des avertissements) en dessous ; jamais rouge, réservé aux urgences. Elle dit toujours la même chose que le pourcentage écrit à côté.
3. **Une petite courbe au pied de la tuile Net**, jour par jour depuis le premier jour du registre : 1,5 px, sans axe ni point, cachée aux lecteurs d'écran (le chiffre et son pourcentage la disent), dans la couleur de sa tendance. Aucune pour un jour lu heure par heure. Les deux parts en avaient une aussi à la recette ; Charles a choisi le 19/11/2026 de n'en garder qu'une, sous Net, car les parts redessinaient la même forme. Les deux parts par jour viennent du serveur, aux mêmes droits que leurs totaux, jamais au MCP (ADR 0144).
4. **Les barres et l'anneau des sortes de vente passent en une rampe cyan** (`--nv-kind-1..4`, une seule teinte du clair au foncé), distincte du rose et du bleu de l'argent et du vert de la tendance. Deux variantes ont été montrées à Charles à la recette du lot (rampe neutre ou cyan) : il a choisi le cyan le 19/11/2026.

## Conséquences

Positives :

- Les chiffres se lisent comme sur Reveal, et la question du pourcentage affiché disparaît.
- Charles voit la TVA qui arrivera avec ses virements, sans la confondre avec son revenu.

Négatives, à surveiller :

- L'estimation peut différer du relevé de Reveal de quelques centimes (arrondi vente par vente chez Reveal, sur la période chez nous) ou davantage si la période ne coïncide pas avec celle d'un virement.
- Un changement de régime de TVA de l'agence (franchise, autre taux) demande une nouvelle ADR.
