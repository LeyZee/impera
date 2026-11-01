# 0036. Factures : ce qu'une quinzaine doit rendre devient un avoir sur une facture déjà émise

Statut : accepted (Charles, 31/10/2026 11h39, « ok 0036 »)
Date : 2026-10-28
Précise : ADR 0023 § Factures (le report, l'erreur corrigée par un avoir)

## Contexte

L'ADR 0023 pose deux règles pour les factures des chatteurs :

- « Un montant reporté reste facturé dans sa période : le report retarde le versement, pas la facture. »
- « Une erreur se corrige par un avoir de la même séquence qui cite la facture d'origine […] ; un oubli en faveur du prestataire devient une ligne de régularisation sur la facture suivante. »

Elle ne dit pas quelle facture cite l'avoir quand une quinzaine finit sous zéro, ni ce qui se passe quand aucune facture ne peut le recevoir. Deux cas le montrent :

- **Une régularisation en faveur de l'agence.** Une vente de la première quinzaine de septembre est remboursée après sa paie, et un ajustement de −100 € la corrige sur la quinzaine suivante. Si cette quinzaine n'a rien d'autre, son total est de −100 € : pas de facture, et le report de −100 € réduit le versement d'octobre. La facture d'octobre dit 500 €, l'agence verse 400 €, et aucune pièce ne porte les 100 €.
- **Une quinzaine négative.** Les remboursements d'un compte dépassent ses ventes : la quinzaine finit sous zéro sans aucune régularisation.

## Décision

**Une facture ne porte que les lignes de sa quinzaine.** Un report, positif ou négatif, n'est jamais repris sur une autre facture. Une régularisation en faveur du chatteur reste une ligne de la facture où elle est portée (ADR 0023).

**Ce qu'une quinzaine doit rendre devient un avoir**, émis à la validation de son relevé :

- une régularisation en faveur de l'agence donne un avoir sur la facture de la quinzaine qu'elle corrige ;
- une quinzaine dont les lignes finissent sous zéro n'a pas de facture. Son manque donne un avoir sur la dernière facture du chatteur d'une quinzaine antérieure qui a encore assez de reste.

Un avoir n'est jamais coupé en plusieurs morceaux. Il ne passe jamais non plus sur une autre facture que celles-là.

**Un avoir prend le régime de TVA et les mentions de la facture qu'il cite**, jamais le régime du jour. Un solde négatif peut en effet retomber sur une facture plus ancienne, émise sous un autre régime (avant la sortie de la franchise, par exemple).

**Quand aucune facture ne peut recevoir l'avoir entier, rien n'est émis et le propriétaire est alerté.** Il règle le cas avec le comptable. Cela arrive quand la quinzaine corrigée n'a pas de facture (elle précède la mise en service), quand elle est inconnue, ou quand la correction dépasse ce qui reste.

**Un avoir émis à l'initiative de l'agence suit sa propre acceptation** : il démarre « en attente », comme une facture. Il ne change pas l'état de la facture qu'il cite. Seul l'avoir qui répond à une contestation fait passer la facture en « créditée ».

Dans l'exemple : septembre est facturé 300 €, la quinzaine suivante émet un avoir de 100 € sur cette facture, et la facture d'octobre reste à 500 €. Au total, les factures moins les avoirs font 700 €, comme les virements (300 € puis 400 €).

## Question au comptable

Il doit valider ce défaut avant la mise en service (EQ-17). L'autre choix serait une ligne de déduction (« solde négatif reporté ») sur la facture suivante. Elle ferait coïncider chaque facture avec son virement, mais elle déplacerait la facturation avec le report, ce que l'ADR 0023 exclut. Si le comptable la préfère, une nouvelle ADR remplacera celle-ci.

## Conséquences

Positives :
- chaque euro que l'agence verse en moins figure sur une pièce, facture ou avoir. Au total, les pièces égalent les virements, au centime ;
- la règle tient dans des fonctions pures (`creditsDue`, `planCreditNotes` dans `payroll/domain/invoices.ts`, `stateAfterCreditNote` dans `invoice-acceptance.ts`), que le lot d'émission appliquera dans la transaction de validation.

Négatives :
- une facture ne correspond pas toujours à un seul virement : le rapprochement (EQ-06, lot 7) impute les avoirs et les reports ;
- l'ajustement doit garder la quinzaine du relevé qu'il corrige. Elle est inconnue aujourd'hui, et le lot 2 (base) doit l'ajouter ;
- une correction sans facture à créditer attend le propriétaire et le comptable.
