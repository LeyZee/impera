# 0041. Factures : l'attestation de résidence fiscale conditionne le versement, pas la facture

Statut : accepted (Charles, 02/11/2026 00h49, « ok 0041 »)
Date : 2026-11-02
Remplace : dans l'ADR 0023 § Factures, au point « Retenue à la source », la phrase « Le dossier prestataire garde l'attestation de résidence fiscale datée ; manquante ou de plus d'un an, la validation affiche un avertissement ». Remplace aussi deux décisions de Charles du 01/11 appliquées par le lot 5c (#355) sans ADR : le choix (a) « sans attestation, pas de facture » et « ok année civile » (l'attestation couvre les quinzaines de son année). L'ADR 0023 reste telle quelle ; l'index des ADR renvoie d'elle à celle-ci.

## Contexte

L'article 182 B du CGI impose une retenue de 25 % sur ce que l'agence verse à un prestataire non résident pour une prestation utilisée en France. Une convention fiscale l'écarte quand elle réserve l'imposition au pays du prestataire (convention France–Bénin) : le prestataire le prouve par une attestation de résidence fiscale de son pays. Au Bénin, c'est l'« attestation de domiciliation fiscale » ou le formulaire 5000-FR visé par la DGI, valable pour une année civile.

L'ADR 0023 prévoyait un simple avertissement à la validation. Le 01/11, Charles a choisi plus strict : l'agence ne retient jamais 25 %, et sans attestation aucune facture ne part (choix (a)). S'y sont ajoutés « ok vérif pièce » (le propriétaire vérifie chaque pièce avant qu'elle compte) et « ok année civile » (l'attestation couvre les quinzaines de l'année qu'elle indique). Le lot 5c a codé tout cela : `tax_residence_missing` et `tax_residence_unverified` retiennent la facture de la quinzaine et la facture rectificative.

La recherche du 02/11 (document « Réponses aux questions comptables », points B3, B4 et B6) montre que le blocage est au mauvais endroit :

- **C'est le versement qui déclenche la retenue, pas la facture.** Le BOFiP exige l'attestation « avant la mise en paiement » (BOI-INT-DG-20-20-20-20 § 210 et 220). Sans elle au jour du paiement, la retenue de droit interne s'applique. La convention ne joue ensuite que par remboursement.
- **Retenir la facture ne protège de rien et crée une faute.** Rien sur la facture ne dépend de l'attestation : le régime de TVA (autoliquidation) et les mentions sont les mêmes avec ou sans elle. Or la facture doit être émise dès la prestation rendue (art. 289 I-3 du CGI). Une facture retenue est une facture émise en retard (amende de l'art. 1737).
- **L'attestation qui compte est celle de l'année du paiement.** Le BOFiP admet que celle de l'année N serve aux paiements jusqu'au 31 mars N+1, à condition de produire ensuite celle de N+1 (§ 200). La recherche recommande de ne pas appliquer cette tolérance. Si l'attestation N+1 ne vient jamais, l'agence aurait dû retenir 25 % sur les paiements de janvier à mars.
- **Avec « jamais de retenue », il reste un seul choix légal** pour un prestataire sans attestation valide : ne pas verser. Payer sans facture est exclu.

Charles a tranché le 02/11 à 00h42 : « versement ».

## Décision

**1. La facture part sans l'attestation.** `tax_residence_missing` et `tax_residence_unverified` ne retiennent plus aucun document : ni la facture de la quinzaine, ni la facture rectificative, ni son avoir d'annulation. Le reste de l'émission ne change pas : il faut toujours un mandat accepté, un régime validé du pays de la fiche et un dossier complet vérifié par le propriétaire. La facture sous convention garde ses mentions. Les deux raisons restent connues du code, pour relire ce qui a déjà été écrit, mais l'émission ne les produit plus. Une facture retenue pour l'une d'elles part au plus tard à la relance quotidienne.

**2. Le versement attend l'attestation de son année.** Un relevé ne peut être marqué payé que si une attestation de résidence fiscale **acceptée par le propriétaire** couvre l'**année civile de la date du virement**. Cette règle s'applique quand le régime en vigueur ce jour-là a une convention qui écarte la retenue, ou quand le versement solde une facture émise sous un tel régime : celle du relevé payé ou d'un relevé reporté dans ce versement (ADR 0038, rapprochement du lot 7). Sans cette attestation, l'enregistrement du versement est refusé avec sa raison : attestation de l'année absente ou refusée (`tax_residence_missing`), ou déposée et pas encore vérifiée (`tax_residence_unverified`). L'attestation d'une autre année ne compte pas, et la tolérance du 31 mars n'est pas appliquée. Un réglage « tolérance du premier trimestre », éteint par défaut, pourra l'ouvrir plus tard, par une autre ADR.

**3. L'agence ne retient jamais 25 %.** Sans attestation valide, elle ne verse pas ; elle ne verse jamais un montant diminué de la retenue. La règle de Charles du 01/11 ne change pas.

**4. Le propriétaire voit le blocage avant de faire le virement.** Nirvana ne fait pas le virement : le propriétaire le fait dans WorldRemit, puis l'enregistre. Le blocage est donc d'abord un état du relevé, affiché avant le virement : « Versement bloqué : attestation de résidence 2027 absente » ou « … à vérifier ». Ce relevé est montré à part dans ce qui reste à envoyer. Ensuite, l'enregistrement d'un versement est refusé tant que la règle du point 2 n'est pas remplie. Le refus est `payout_blocked_conflict` (409), avec sa raison. L'enregistrement garde quelle attestation a justifié le versement. Un virement fait malgré le blocage ne s'enregistre qu'une fois l'attestation de son année acceptée. Nirvana ne l'efface pas et ne le cache pas.

**5. Le rappel anticipe janvier.** Le rappel ambre du 1er décembre demande l'attestation de l'année suivante (lot 5c-2). Son texte dit désormais : « Sans celle de 2027, ses versements à partir du 1er janvier 2027 seront bloqués. » Une alerte de blocage de facture n'a plus lieu d'être.

**6. La pièce qui débloque un versement est gardée dix ans après lui.** Son verrou de conservation est rallongé, sur les deux buckets, jusqu'à dix ans après la fin de l'exercice du versement, et ne raccourcit jamais. Un job mis en file avec l'enregistrement du versement le fait, et un filet quotidien rattrape un verrou pas encore assez long. Un bucket qui ne répond pas ne fait jamais refuser un versement. Le lot 5c le rallongeait à l'émission d'une facture sous convention, ce qui ne suffit plus maintenant que la facture peut partir avant la pièce. Le reste ne change pas : vérification par le propriétaire (« ok vérif pièce »), verrou de 30 jours au dépôt, dix ans à l'acceptation, copie chez OVHcloud, effacement d'une pièce refusée à la fin de son verrou (« ok purge a »).

**7. Le contrat fait de l'attestation une condition du versement.** Le prestataire sous convention s'engage à fournir chaque année l'attestation de l'année en cours. Le contrat dit que le versement l'attend (texte du contrat, lot 5a).

## Conséquences

Positives :
- la facture part à l'heure : l'agence ne risque plus l'amende pour facture émise en retard ;
- le blocage est là où la loi met la retenue, au versement, et l'agence ne retient jamais 25 % ;
- la règle est plus simple : une seule attestation, celle de l'année du virement, au lieu d'une par année de quinzaine.

Négatives :
- **un versement bloqué peut dépasser l'échéance de la facture** (60 jours par défaut, ADR 0038). Le prestataire peut alors réclamer les pénalités de retard (3 fois le taux légal) et l'indemnité forfaitaire de 40 €. L'alerte d'échéance J-7 du lot 8 le dit au propriétaire, et la clause du point 7 rend ce retard difficile à reprocher à l'agence quand il vient du prestataire ;
- en janvier, chaque prestataire sous convention attend l'attestation de la nouvelle année avant son premier versement. Le rappel du 1er décembre et le délai de la DGI (72 heures) laissent la marge, sauf si le prestataire ne fait pas la démarche ;
- un virement fait malgré le blocage reste possible dans WorldRemit, et Nirvana ne peut que refuser de l'enregistrer jusqu'à l'attestation.

À faire, dans une PR à part (fil Équipe, après le rapprochement du lot 7, sans migration) :
- retirer `tax_residence_missing` et `tax_residence_unverified` de l'émission (facture, rectificative et avoir d'annulation) et des raisons de non-émission, avec leurs textes d'alerte Telegram (relecture Telegram) ;
- refuser l'enregistrement d'un versement selon le point 2, avec les deux raisons, et l'état « versement bloqué » sur le relevé ;
- rallonger le verrou de l'attestation à l'enregistrement du versement (point 6) ;
- changer le texte du rappel du 1er décembre (point 5, relecture Telegram) ;
- mettre à jour EQ-06, le README de la paie, le glossaire et l'index des ADR.

À faire relire par le comptable et l'avocat : la clause « versement après attestation » face à l'article L441-10 du Code de commerce (délais de paiement et pénalités de retard).
