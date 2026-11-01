# 0039. Factures : une contestation fondée se corrige par la paie, jamais par un avoir écrit à la main

Statut : proposed
Date : 2026-11-01
Précise : l'ADR 0023 (§ Factures : l'acceptation, la correction d'une facture) et l'ADR 0036

## Contexte

L'ADR 0023 fixe trois règles :

- le prestataire accepte chaque facture, ou la conteste avec un motif, avant la fin du délai du mandat ; sans réponse, la facture est acceptée tacitement ;
- une erreur se corrige par un avoir de la même séquence, qui cite la facture d'origine ;
- un oubli en faveur du prestataire devient une ligne de régularisation sur sa facture suivante, avec sa période d'origine.

L'ADR 0036 ajoute qu'un montant en faveur de l'agence devient un avoir émis par la paie à la validation. Ainsi les factures moins les avoirs égalent les virements, au centime.

La fiche EQ-06 disait que la résolution d'une contestation est « un avoir, éventuellement suivi d'une nouvelle facture, ou un refus motivé ». La base du lot 2 (migration 0041) a suivi : une contestation finit en `credited` (un avoir écrit après elle cite la facture) ou en `contest_refused`. Le lot 6, qui code ces étapes, bute sur deux trous.

1. **Un avoir écrit à la main ne passe pas par la paie.** Si le propriétaire écrit un avoir pour répondre à une contestation, le virement ne baisse pas : les factures moins les avoirs ne font plus les virements, et la règle de l'ADR 0036 tombe. Une « nouvelle facture » pour la même quinzaine a le même défaut. Elle est en plus impossible : une quinzaine n'a qu'une facture (index `invoices_statement_unique`), et la paie ne verserait pas son montant.
2. **Un avoir contesté n'a qu'une fin, le refus.** Quand l'agence donne raison au prestataire, l'avoir reste « contesté » pour toujours. Le lot 2 a laissé cette question ouverte pour le lot 6.

Un prestataire conteste pour trois raisons en pratique :
- un montant trop bas (une vente oubliée, un taux faux) ;
- un montant trop haut (rare) ;
- une erreur de texte (nom, adresse, IFU, mention).

## Décision

**1. Répondre.** Seul le prestataire répond, jamais le propriétaire à sa place. Il répond « J'accepte », ou « Je conteste » avec un motif de 1 à 500 caractères. Il répond avant la fin du délai : l'émission plus le délai du mandat (7 jours par défaut, 60 au plus), à la seconde près. Le PDF imprime cette fin avec son heure, dans le fuseau de l'agence (Europe/Paris). Passé ce délai, la facture est acceptée tacitement. Un job daté pose cette acceptation à cet instant précis. Un avoir suit la même acceptation. Chaque étape est datée dans `invoice_events`, en ajout seul, et dans `audit_log`.

**2. Le propriétaire est prévenu.** Chaque contestation publie `invoice_contested`, une fois par document. L'événement porte le numéro du document et le membre par son identifiant. Il ne porte jamais le motif ni un nom : le propriétaire les lit dans la Paie. Telegram le dit en important (fil Telegram). La Paie montre les contestations ouvertes en ambre (lot 8).

**3. Deux fins, décidées par le propriétaire seul.** Un manager ne tranche pas.
- **Refusée**, avec un motif : le document reste tel quel (`contest_refused`, déjà en base).
- **Fondée**, avec un motif, et dans la même action la correction (`contest_upheld`). La correction est un ajustement de paie ou plus. Chacun nomme le document contesté et corrige sa quinzaine (`corrects_statement_id`). Selon l'erreur :
  - **montant trop bas** : un ajustement en faveur du prestataire. Il devient une ligne de régularisation sur sa facture suivante, avec la période d'origine (ADR 0023) ;
  - **montant trop haut** : un ajustement en faveur de l'agence. Il devient un avoir sur la facture contestée à la validation suivante (ADR 0036) ;
  - **erreur de texte sur une facture** (nom, adresse, identifiant, mention) : « annuler et refacturer ». C'est une paire d'ajustements du montant qui reste de la facture. Le premier, négatif, donne l'avoir qui annule la facture. Le second, positif, donne une ligne de la facture suivante, qui imprime le dossier corrigé. Les virements ne bougent pas.

  Une contestation n'est fondée qu'avec au moins un ajustement. L'étape et ses ajustements s'écrivent dans une seule transaction.

**4. Aucun avoir écrit à la main ne répond à une contestation.** Chaque document vient de la paie, si bien que les factures moins les avoirs font toujours les virements (ADR 0036). L'état `credited` du lot 2 disparaît. Rien n'est déployé et aucune donnée ne le porte : la migration du lot 6 le remplace par `contest_upheld` dans la contrainte, le déclencheur, la politique et l'index unique.

**5. Un avoir contesté a les mêmes deux fins.** Par exemple, un avoir trop fort se corrige par un ajustement en faveur du prestataire. La question laissée ouverte par le lot 2 est ainsi fermée.

## Conséquences

- L'argent ne bouge que par la paie. La piste d'audit va de la contestation à l'ajustement, puis au document, puis au virement, et un contrôle la suit sans trou.
- La correction n'est pas immédiate : elle arrive avec la prochaine quinzaine validée, quinze jours au plus. La facture corrigée est un document de la période suivante, pas un remplacement dans la même période. L'avoir qui cite la facture d'origine, puis la nouvelle facture, sont la forme d'une facture rectificative. Le comptable la confirme avec les autres textes avant la mise en service (EQ-17).
- Le prestataire voit sa correction là où il lit déjà ses commissions : son relevé et sa facture suivante.
- Migration du lot 6, numéro attribué par Bilan :
  - `contest_upheld` remplace `credited` ;
  - `pay_adjustments.contested_invoice_id` (nullable), avec un contrôle : l'ajustement est du membre du document et corrige la quinzaine de ce document ;
  - `invoice_contested` entre dans les types d'événements.
- Ordre du code : l'acceptation, la contestation, le refus, l'acceptation tacite et l'alerte ne dépendent pas de cette ADR et passent d'abord. La fin « fondée » vient après son acceptation.
- Écrans (lot 8) : « Annuler et refacturer » crée la paire d'ajustements. « Contestation fondée » demande le motif et la correction ensemble.

## Options écartées

- **Un avoir écrit à la main par le propriétaire**, comme le disait la fiche. La paie ne le connaît pas, donc les documents ne font plus les virements (ADR 0036).
- **Une facture de remplacement dans la même quinzaine.** Il faudrait une seconde facture par quinzaine et un versement hors de la paie. Elle a le même défaut que l'avoir à la main.
- **Laisser un avoir contesté sans fin.** Le document resterait contesté pour toujours, et rien ne dirait au prestataire que l'agence lui a donné raison.
