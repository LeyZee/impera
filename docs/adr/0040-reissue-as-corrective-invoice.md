# 0040. Factures : « annuler et refacturer » émet une facture rectificative, sous le régime de la facture annulée

Statut : accepted (Charles, 01/11/2026 18h37, « ok 0040 »)
Date : 2026-11-01
Remplace : dans l'ADR 0039, au point 3, la phrase « Le second, positif, donne une ligne de la facture de cette quinzaine, qui imprime le dossier corrigé », et la conséquence « La ligne refacturée prend le régime du jour, alors que l'avoir garde celui de la facture d'origine ». La règle « la paire part ensemble ou pas du tout » de l'ADR 0039 vaut désormais pour l'avoir d'annulation et la facture rectificative. L'ADR 0039 reste telle quelle ; l'index des ADR renvoie d'elle à celle-ci.

## Contexte

L'ADR 0039 corrige une erreur de texte sur une facture (nom, adresse, identifiant, mention) par « annuler et refacturer ». C'est une paire d'ajustements de paie du montant qui reste de la facture. L'ajustement négatif donne l'avoir qui annule la facture. L'ajustement positif devait devenir une ligne « Régularisation » de la facture de la quinzaine où la paire arrive.

Le lot 6c (#346) a codé cette règle. En la relisant, on a vu ce qu'elle produit : la ligne refacturée prend le régime de TVA du jour de l'émission, et elle est imprimée sur une facture qui porte la période du jour. L'ADR 0039 l'avait noté dans ses conséquences comme une question pour le comptable. C'est en réalité une erreur. Refacturer, c'est facturer de nouveau la même prestation. Cette prestation a eu lieu pendant la période de la facture d'origine, sous le régime de ce moment-là. Si le régime du prestataire a changé entre-temps (il sort de la franchise, il change de pays), la même prestation serait refacturée avec une autre TVA et d'autres mentions. Les virements resteraient justes, mais la TVA ne correspondrait plus à la prestation.

**Pourquoi la ligne ne peut pas rester sur la facture du jour.** Une facture a un seul régime de TVA et une seule liste de mentions, qui valent pour toutes ses lignes. De plus, la base impose à la facture d'une quinzaine (`keep_invoice`) le régime du prestataire au jour de l'émission et la période de son relevé. Une ligne qui garde l'ancien régime et l'ancienne période ne peut donc pas y entrer : il faudrait deux régimes sur un même document. La refacturation devient un document à part.

## Décision

**1. La refacturation est une facture rectificative.** C'est une facture (`kind = 'invoice'`) qui nomme la facture qu'elle refait (`reissued_invoice_id`). Comme un avoir, elle reprend de la facture annulée :
- sa période, c'est-à-dire la prestation qu'elle facture ;
- son régime et sa copie du régime ;
- les mentions de ce régime, telles que la facture annulée les a figées.

Elle imprime ce qui est du jour : les parties (donc le dossier corrigé), la désignation de la prestation et les conditions de paiement, avec sa propre échéance. Elle a une seule ligne « Régularisation », du montant de la paire. Le détail de la ligne dit « Refacturation de la facture N du … » et la période corrigée.

**2. Sa première mention est figée.** C'est « Facture rectificative de la facture N du … ». Elle est écrite à l'émission, comme « Avoir sur la facture N du … » en tête d'un avoir. Le PDF la lit et ne la recalcule jamais. Il a pour titre « Facture rectificative », nomme la facture rectifiée, dit qu'elle est annulée par avoir et que la rectificative en reprend la période, le régime de TVA et les mentions. Il ne joint pas l'annexe du relevé : la rectificative ne facture pas la quinzaine du relevé qui l'émet. Son PDF est rendu une fois et gardé sous verrou comme tout document (ADR 0037).

**3. L'avoir d'annulation et la facture rectificative partent ensemble ou pas du tout.** Le job d'émission les écrit dans la même transaction, l'avoir puis la rectificative. Ils prennent les deux numéros suivants de la séquence du prestataire. L'avoir nomme lui aussi la facture refaite (`reissued_invoice_id`, égal à la facture qu'il cite). Si la rectificative ne peut pas partir (dossier pas encore vérifié, régime, réglages de l'agence), l'avoir ne part pas non plus. Les deux sont signalés au propriétaire (`invoice_not_issued`) et partent au passage suivant (le lot 5 remet l'émission en file).

**4. La base le vérifie** (migration 0052) :
- à l'insertion d'une rectificative : elle cite une facture du même prestataire, jamais un avoir. Elle en a la période, le régime, la copie du régime et les mentions, et sa première mention cite le numéro de cette facture. L'avoir d'annulation est déjà écrit dans la même transaction, avec le même relevé et le montant opposé ;
- à l'insertion de l'avoir d'annulation : il prend tout ce qui reste de la facture ;
- à la fin de la transaction, par un déclencheur de contrainte différé, dans les deux sens : un avoir d'annulation sans sa rectificative, ou une rectificative sans son avoir, fait échouer toute la transaction ;
- par un index unique, une facture n'est refaite qu'une fois : au plus un avoir d'annulation et une rectificative pour elle. L'index « une facture par relevé » ne compte plus que la facture de la quinzaine du relevé, car la rectificative facture la période d'une autre facture. Il garde ce qu'il protégeait : un relevé ne facture qu'une fois sa propre quinzaine.

**5. La facture du jour ne porte plus la ligne refacturée.** Elle facture seulement la quinzaine de son relevé. Les virements ne bougent pas : la paire s'annule dans la paie, l'avoir et la rectificative s'annulent sur les documents.

**6. Une rectificative reste une facture.** Le prestataire l'accepte ou la conteste comme toute facture. Si sa contestation est fondée, elle se corrige comme une autre facture, et peut à son tour être annulée et refaite. Ses ajustements corrigent le relevé de la période qu'elle facture, pas celui de la quinzaine qui l'a émise. Sa propre rectificative garde encore la période et le régime d'origine.

## Conséquences

- La TVA d'une prestation ne dépend plus du jour où l'on corrige une erreur de texte.
- La question « TVA de la ligne refacturée quand le régime a changé », ajoutée par l'ADR 0039 à celles du comptable, est tranchée ici. Il reste à lui faire valider la forme : l'avoir d'annulation et la facture rectificative, et le texte de la mention « Facture rectificative de la facture N du … » (EQ-17, avant la mise en service).
- Une refacturation coûte un document de plus et son PDF. Le prestataire reçoit trois documents au lieu de deux : la facture de sa quinzaine, l'avoir qui annule l'ancienne facture, et la rectificative.
- À surveiller : un ajustement positif d'un montant (« montant trop bas », ADR 0039 § 3) devient toujours une ligne de régularisation sur la facture suivante, sous le régime du jour. Cette ADR ne change pas ce cas. Si le comptable veut la même règle pour lui, il faudra une nouvelle décision.
- Migration 0052, numéro attribué par Bilan :
  - `invoices.reissued_invoice_id` (nullable) et sa clé étrangère ;
  - un contrôle : seul l'avoir d'annulation, qui cite la facture qu'il nomme, ou une facture porte `reissued_invoice_id` ;
  - l'index unique d'une refacturation par facture, et l'index « une facture par relevé » limité aux factures de la quinzaine du relevé ;
  - `keep_invoice` vérifie la rectificative et l'avoir d'annulation (point 4) ;
  - le déclencheur différé qui les lie dans les deux sens ;
  - `keep_contest_correction` : la correction d'un document corrige le relevé du membre pour la période du document.

## Options écartées

- **Garder la ligne sur la facture du jour** (ADR 0039) : la prestation est refacturée avec la TVA du jour.
- **Une ligne à part sous l'ancien régime sur la facture du jour** : une facture n'a qu'un régime et qu'une liste de mentions.
- **Rattacher la rectificative au relevé de la facture annulée** : ce relevé est validé, peut-être payé, et ne doit plus rien émettre. La rectificative est émise par la validation du relevé où la paire arrive, comme l'avoir. L'ADR 0039 a écarté une « facture de remplacement dans la même quinzaine » parce qu'elle verserait de l'argent hors de la paie. La rectificative n'a pas ce défaut : elle vient de la paire d'ajustements, et la paie ne verse rien de plus.
