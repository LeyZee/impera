# 0038. Paie : un petit montant est reporté deux fois au plus, pour que chaque facture soit payée avant son échéance

Statut : accepted (Charles, 31/10/2026 14h20, « ok 0038 », après « ok ;) » au versement des reports repris d'Imperium ; texte précisé avant fusion à la relecture d'Extension, sans changer la décision acceptée, phrases amendées lues par Charles, « ok ;) » 14h31)
Date : 2026-10-31
Remplace : dans l'ADR 0023 (§ Les règles d'Imperium, telles quelles), « le report des petits montants sous le minimum de versement » repris à l'identique, pour le seul report d'un montant positif ; précise son § Factures (l'échéance)

## Contexte

L'ADR 0023 reprend d'Imperium le report des petits montants : un relevé dont le total est positif mais sous le minimum de versement ne verse rien, et son total passe sur la quinzaine suivante, autant de fois qu'il le faut. La même ADR pose qu'« un montant reporté reste facturé dans sa période : le report retarde le versement, pas la facture ».

Les factures (EQ-06) rendent ces deux règles incompatibles avec le Code de commerce dès que le report dure :

- **la facture est émise à la validation du relevé, et son échéance est figée ce jour-là.** Elle porte une date (`issued_on` + `due_days`) et les conditions de paiement que la loi impose (art. L441-9 : échéance, escompte, pénalités, indemnité de 40 € de l'art. D441-5). Le relevé qui la versera n'existe pas encore, l'échéance ne peut donc pas suivre le versement ;
- **le délai de paiement convenu ne dépasse pas 60 jours après la date de la facture** (art. L441-10). #328 (EQ-06 lot 3, pas encore fusionnée quand cette ADR est écrite) ramène le plafond du réglage à 60 jours (il était à 90) ;
- **le défaut du réglage est de 15 jours** (`DEFAULT_INVOICE_DUE_DAYS`). Avec lui, un seul report suffit à dépasser l'échéance : facture du 17 novembre, échéance le 2 décembre, versement par la quinzaine suivante vers le 5 décembre ;
- **un report sans limite peut laisser une facture impayée au-delà de son échéance, quel que soit le délai.** Un chatteur qui vend peu reste sous le minimum plusieurs quinzaines de suite : sa première facture attend des mois. L'agence doit alors, de plein droit, les pénalités de retard et 40 € d'indemnité par facture, et s'expose à l'amende administrative de la DGCCRF (art. L441-16). Sur une facture de 9 €, l'indemnité dépasse le montant.

Charles (31/10) : « une facture reportée peut dépasser son échéance avant d'être versée, à trancher avant la mise en service / fais ce que tu me conseillerais de faire en tant que comptable français ».

## Décision

**L'échéance d'une facture est sa date d'émission plus le délai du réglage, 60 jours par défaut au lieu de 15.** Le réglage `due_days` accepte de 45 à 60 jours.

**Un total positif sous le minimum est reporté deux fois de suite au plus. La troisième quinzaine le verse, même sous le minimum.** Le registre des reports garde combien de fois de suite le montant a déjà été reporté (1 ou 2). Exemple, avec le minimum par défaut de 15 € :

- 1–15 novembre : 9 €. Relevé validé et facture émise le 17 novembre, échéance le 16 janvier. Rien n'est versé, 9 € sont reportés (première fois).
- 16–30 novembre : 4 €, soit 13 € avec le report. Toujours sous 15 € : 13 € sont reportés (deuxième fois).
- 1–15 décembre : 1 €, soit 14 €. C'est la troisième quinzaine : les 14 € sont versés vers le 20 décembre, environ 33 jours après la facture du 17 novembre et 27 jours avant son échéance.

**La garantie suppose que l'agence valide et verse chaque quinzaine sans traîner.** Entre la fin de la première quinzaine et celle de la troisième, il y a deux quinzaines (28 à 31 jours). Avec 60 jours d'échéance, il reste donc au moins 29 jours après la fin de la troisième quinzaine pour valider son relevé et faire le virement ; avec 45 jours, il en reste 14. Le délai de versement annoncé à l'équipe (jusqu'à 30 jours ouvrés, PAIE-32) n'est qu'une annonce, et une quinzaine bloquée (#307) ne se valide pas. Au-delà, le seul filet est l'alerte d'échéance (ci-dessous) : elle dit au propriétaire, avant l'échéance, qu'une facture attend encore son versement.

**Une quinzaine négative ne remet pas le rang à zéro tant que le cumul reste positif.** Exemple : 9 €, puis −5 € : 4 € sont reportés pour la deuxième fois, car c'est encore la facture de la première quinzaine qui attend.

**Un cumul nul ou négatif ne verse rien et remet à zéro le nombre de reports.** L'agence ne doit alors plus rien : ce qu'elle devait s'éteint par compensation avec ce que le chatteur lui doit (art. 1347 du Code civil). Chaque montant rendu porte son avoir ou, quand aucune facture ne peut le recevoir, l'alerte au propriétaire (ADR 0036). Le report négatif reste celui d'Imperium : il n'a pas de limite, car aucune facture n'attend derrière lui.

**Un report positif repris d'Imperium est versé par la première quinzaine de Nirvana**, même sous le minimum : Imperium ne comptait pas les reports successifs, son rang n'est pas connu, et sa facture peut déjà être ancienne. Un report positif né d'une quinzaine de Nirvana avant l'entrée en service de cette règle compte comme un premier report.

**Rien ne change pour le reste.** Le minimum de versement garde ses règles (PAIE-22 : il change pour une quinzaine pas encore commencée, jamais en arrière), le dernier relevé d'un membre qui part verse tout (EQ-14), et la règle s'applique à partir de la première quinzaine pas encore commencée à son entrée en service. Aucun relevé validé n'est recalculé.

**L'échéance se surveille.** Une facture qui n'est pas entièrement versée passe en ambre 7 jours avant son échéance, en rouge une fois l'échéance passée (EQ-06, lot 8, d'après le rapprochement du lot 7).

## Question au comptable

Il doit confirmer avant la mise en service (EQ-17) :

- le délai de 60 jours à compter de la date de la facture, plutôt que 45 jours fin de mois ;
- la même règle pour tous les prestataires, établis en France ou non : la loi française s'applique au mandat d'autofacturation, et l'agence ne trie pas ses chatteurs par pays.

## Conséquences

Positives :
- chaque facture est versée au plus tard par le relevé de la troisième quinzaine, une trentaine de jours après son émission selon les dates de validation et de virement ; l'échéance est tenue tant que ce relevé est validé et versé dans le délai dit plus haut ;
- la règle reste un compte entier dans le moteur de paie, sans date prévue à deviner : elle se teste en unitaire comme le reste du calcul.

Négatives :
- un chatteur qui vend très peu reçoit parfois un virement sous le minimum, et les frais de WorldRemit pèsent sur ce petit virement ;
- c'est une règle d'Imperium qui change, ce que l'ADR 0023 ne permet que par une ADR ;
- une validation ou un virement en retard, ou une quinzaine bloquée, peut encore faire passer une échéance : l'alerte le dit, rien ne l'empêche.

À faire, dans une PR à part (moteur de paie, fil Équipe) :
- `commission-statements.ts` : le relevé lit le rang du report positif qui entre, et verse au troisième ;
- base : le rang dans `carry_overs`, le réglage `due_days` entre 45 et 60, `DEFAULT_INVOICE_DUE_DAYS` qui passe de 15 à 60, une nouvelle migration ;
- version du moteur relevée, tests unitaires et d'intégration du report borné et de la remise à zéro ;
- fiche EQ-06, `README.md` du module et glossaire (« Report », « Minimum de versement ») mis à jour.

## Alternatives rejetées

- **Une échéance qui suit le versement** (« à réception du paiement ») : la facture est figée à son émission, et l'art. L441-9 exige une date.
- **Le report sans limite d'Imperium** : une facture peut rester impayée au-delà de 60 jours, avec pénalités, indemnité de 40 € par facture et amende.
- **Ne plus avoir de minimum** : chaque quinzaine verserait tout, même 3 €, et les frais de virement mangeraient les petits montants.
- **Facturer seulement ce qui est versé** (une facture qui regroupe les quinzaines reportées) : l'ADR 0023 et l'ADR 0036 lient la facture à sa quinzaine, et l'art. 289 du Code général des impôts veut une facture dès la prestation, une facture récapitulative ne couvrant pas plus d'un mois civil.
- **Verser quand l'échéance approche** : il faudrait prévoir la date du prochain versement, que personne ne connaît d'avance. Le compte de reports donne la même garantie sans deviner.
