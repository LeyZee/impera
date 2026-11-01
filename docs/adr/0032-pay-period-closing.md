# 0032. Paie : la quinzaine se clôture pour toute l'équipe à sa première validation

Statut : accepted (Charles, 28/10/2026 16h27, « oui ;) » à « accepter l'ADR 0032, puis un mot pour pousser »)
Date : 2026-10-28
Complète : ADR 0023 § Paie (la course entre un rapport tardif et la validation, la vente tardive, le taux de change)

## Contexte

L'ADR 0023 reprend les règles de paie d'Imperium à l'identique. Deux d'entre elles portent sur toute l'équipe, pas sur un membre seul :

- l'objectif collectif se mesure sur le net de toute l'équipe, ventes des managers comprises ;
- la part d'équipe d'un manager se calcule sur le net des autres membres.

Le relevé d'un membre dépend donc des rapports de ses collègues (EQ-04, calcul pur de #256).

Or les relevés se valident un par un. Il y a quatre yeux : un manager ne valide jamais le sien, et le propriétaire valide celui du manager. Les contrats et les tables du lot 2 (#257, migration 0028) ferment une quinzaine **membre par membre**. Un rapport validé après la validation de son membre va sur la quinzaine suivante de ce membre.

Cette fermeture par membre laisse ouvert un cas qu'aucune règle d'Imperium ne prévoit. Le relevé de Théo pour la quinzaine p est validé, celui de Léa ne l'est pas encore. Un rapport de Léa pour p est validé ensuite. Il entre dans le relevé de Léa pour p, donc dans le net de l'équipe de p, mais le relevé de Théo a été validé sur un net plus petit. Deux relevés de la même quinzaine ne voient plus le même net d'équipe, ni le même palier collectif, ni la même base pour la part du manager.

Le même problème touche le taux de change. Si chaque relevé copiait le taux du jour de sa propre validation, deux relevés de la même quinzaine, validés des jours différents, convertiraient les mêmes dollars à deux taux. Le net de l'équipe ne serait plus la somme des nets.

Enfin, les relectures de #257 (Bilan, Telegram) demandent qu'aucune écriture concurrente ne passe entre la lecture et la validation. La garde des quinzaines fermées lit en READ COMMITTED : une prime insérée pendant une validation pas encore engagée passerait le déclencheur.

## Décision

**La première validation d'un relevé de la quinzaine p clôture p pour toute l'équipe, dans la même transaction.** Ce qui fait le net de l'équipe est figé ce jour-là, pour tous les relevés de p, validés ou pas encore.

Ce que la clôture fige :

- **Les rapports comptés dans p** : tous les rapports validés qu'aucune clôture n'a encore inscrits et dont la quinzaine d'origine est p ou une quinzaine antérieure. Les tardifs sont donc compris, et un tardif ancien ne glisse pas de quinzaine en quinzaine. Chacun est inscrit au registre `pay_period_reports`, une ligne par rapport, avec le rapport pour clé primaire : un rapport n'est compté qu'une fois, dans une seule quinzaine.
- **Les taux de change de p.** C'est le dernier taux lu le dernier jour de la quinzaine ou avant, dans le fuseau de l'agence, pour chaque devise qu'un compte compté utilise. Ce n'est jamais le taux du jour de la validation. La clôture est refusée tant qu'une de ces devises n'a pas de taux (`exchange_rate_missing_conflict`) : un taux n'est jamais deviné.
- **Le net de l'équipe et l'objectif collectif tel qu'atteint.** Les paliers individuels et l'objectif collectif de p sont déjà figés par la migration 0028 dès qu'un relevé de p est validé.

Ce qui reste propre à chaque membre jusqu'à la validation de son relevé : ses primes, ses malus et leurs annulations, ses ajustements, ses reports entrants, son taux de commission, sa part d'équipe, son rôle et le minimum de versement. Ces entrées ne touchent personne d'autre ; elles gardent la fermeture par membre de la migration 0028.

**Un relevé d'une quinzaine clôturée se calcule sur la clôture.** Il prend les rapports que le registre a comptés pour son membre dans p, les taux de la clôture, et le net de l'équipe qui en découle. Son `inputs_hash` couvre la clôture : les rapports du registre, les taux et le net de l'équipe. Le déclencheur de validation vérifie que le relevé validé porte bien la clôture de sa quinzaine. Il demande trois choses :

- le même net d'équipe ;
- les mêmes taux ;
- **exactement les mêmes rapports** : les rapports des lignes de la révision validée sont ceux que le registre a comptés pour ce membre dans p, ni plus ni moins.

Un relevé calculé avant la clôture, qui compterait un rapport parti en p+1, ne se valide donc pas : il doit d'abord être recalculé. Sinon ce rapport serait payé deux fois.

**Un rapport tardif se décide par le registre, jamais par une date.** Un rapport validé qu'aucune clôture n'a inscrit au registre est compté :

- dans sa propre quinzaine, si elle n'est pas clôturée ;
- sinon dans la **première quinzaine non clôturée de l'équipe**, comme rapport tardif. Il garde sa quinzaine d'origine, et sa ligne garde les règles de paie (devise, TVA, commission de la plateforme) de cette quinzaine d'origine.

C'est la première quinzaine non clôturée pour l'équipe, pas pour le membre. Si le relevé de p d'un collègue est encore un brouillon et que son rapport de p arrive après la clôture, ce rapport va en p+1. Sinon le net d'équipe figé ne serait plus la somme des nets de p.

Le retard se décide au calcul, quand le registre est lu, et non quand le rapport est écrit. Prenons un rapport validé pendant la transaction de clôture : en READ COMMITTED, la clôture ne le voit pas, donc elle ne l'inscrit pas. Il est alors tardif et compté dans la quinzaine non clôturée suivante. C'est le résultat qu'aurait donné un ordre en série, clôture puis rapport. Les rapports n'ont donc pas besoin du verrou de la clôture, et aucun rapport n'est compté zéro ou deux fois.

Un rapport compté ne change plus. Un rapport validé ne change déjà jamais (migration 0026). Sa correction est un nouveau rapport, compté là où il tombe.

**Les quinzaines se clôturent dans l'ordre.** Une clôture porte sur la quinzaine qui suit la dernière clôturée, ou sur une quinzaine plus récente si celles d'entre les deux n'ont aucun relevé. Elle n'a lieu qu'une fois la quinzaine finie dans le fuseau de l'agence.

**Ce que la validation fait, dans une seule transaction** (sous `withMember`, pour que la RLS garde les quatre yeux) :

1. prendre le verrou `payroll.close`, puis le verrou (membre, quinzaine) d'EQ-03 ;
2. si p n'est pas clôturée, la clôturer. Elle lit les rapports de **chaque** créatrice par une boucle `enterCreator`, les inscrit au registre, puis fige les taux et le net de l'équipe. Elle compare ensuite ce qu'elle a lu au nombre de rapports validés et non inscrits que la base connaît, par une lecture `withAdmin` bornée à ce compte. Si un rapport lui a échappé (une créatrice que celui qui valide ne peut pas lire), elle refuse avec un 409 plutôt que de le laisser partir en retard sans bruit ;
3. recalculer le relevé du membre sur la clôture, et répondre 409 (`commission_statement_changed_conflict`) s'il diffère de la révision affichée ;
4. passer le relevé à « validé » ;
5. écrire le report sortant s'il y en a un. Il n'est accepté que tant que le relevé est validé et pas encore payé.

**Verrous**, toujours dans cet ordre, en `pg_advisory_xact_lock` à clés fixes :

- `payroll.close` (global) : pris par la validation, par le job de recalcul et par les écritures de paliers, d'objectifs et du minimum de versement. Le job écrit les brouillons de toute une quinzaine ; une validation ne doit pas les voir à moitié écrits ;
- (membre, quinzaine), le verrou d'EQ-03 : pris par la validation et par chaque prime, malus, annulation et ajustement du membre, sur la quinzaine qu'ils touchent. Les rapports le prennent déjà.

Un rapport ne prend que le second, et aucune écriture d'entrée ne prend `payroll.close` après lui : l'ordre ne peut pas s'inverser, il n'y a donc pas d'interblocage.

**Données** (migration 0029) :

- `pay_period_closings` : une ligne par quinzaine clôturée, avec son net d'équipe en entier, l'objectif tel qu'atteint, les taux figés, qui l'a clôturée et quand ;
- `pay_period_reports` : le registre, avec un rapport, sa quinzaine de comptage et son membre.

Les deux tables sont en ajout seul pour tous les rôles, sous `FORCE ROW LEVEL SECURITY`. Seuls le propriétaire et un manager actif y insèrent, dans la transaction de la clôture. Le déclencheur du registre vérifie quatre choses : le rapport est validé, il est bien celui du membre, sa quinzaine d'origine n'est pas après sa quinzaine de comptage, et cette quinzaine vient d'être clôturée dans la même transaction. Ce dernier point se vérifie par `xmin` : la ligne de clôture a été écrite par la transaction courante (`xmin = pg_current_xact_id()::xid`), hors de tout point de sauvegarde. Aucune transaction plus tardive ne peut donc ajouter un rapport à une clôture passée.

**Point produit, en attente de Charles** : la validation peut se heurter à des rapports de p encore en attente de relecture. Défaut posé tant qu'il n'a pas répondu : la première validation de p refuse de clôturer tant qu'un rapport de p est envoyé mais ni validé ni renvoyé, et dit combien attendent. Une clôture implicite enverrait sinon ces rapports en p+1 sans que personne l'ait vu.

## Conséquences

Positives :
- tous les relevés d'une quinzaine voient le même net d'équipe, le même palier collectif et les mêmes taux, quel que soit le jour de leur validation ;
- un rapport est compté une seule fois, et la base le garantit par sa clé primaire. Une course entre une clôture et une validation de rapport ne perd rien ;
- la règle d'Imperium (la vente arrivée après validation passe sur la période suivante) s'applique à toute l'équipe, comme une période validée dans Imperium.

Négatives :
- un rapport validé après la clôture de sa quinzaine va en p+1, même si le relevé de son membre pour p est encore un brouillon. La règle sur les rapports en attente (point produit) limite ce cas aux rapports qui arrivent vraiment après ;
- deux tables et deux verrous de plus. Le verrou `payroll.close` sérialise les validations et les recalculs. C'est voulu : la paie se valide deux fois par mois.

Tests du lot de l'application, qui prouvent ces règles contre une base réelle :
- une validation de rapport engagée pendant une clôture : le rapport part sur la quinzaine non clôturée suivante, compté une fois ;
- une prime contre une validation du même membre : la prime attend le verrou, puis est refusée ;
- deux recalculs concurrents ne font qu'un brouillon par membre, et un rejeu n'écrit rien ;
- l'ordre des verrous ne s'inverse jamais : pas d'interblocage entre une validation, un recalcul et une prime ;
- un relevé calculé avant la clôture qui compte un rapport parti en p+1 est refusé à la validation.

À surveiller :
- le contrat `payroll.ts` (lot 2) dit qu'un rapport tardif va sur la première quinzaine ouverte du membre. Le lot 3 le corrige en « de l'équipe », et `PayrollPeriod` y gagne sa clôture ;
- l'import d'Imperium (EQ-07) clôture ses quinzaines dans l'ordre, par le même chemin.

## Alternatives rejetées

- **Fermer la quinzaine membre par membre**, le choix du lot 2 : les relevés d'une même quinzaine ne voient plus le même net d'équipe (voir le contexte).
- **Valider toute la quinzaine d'un coup** : un manager ne peut pas valider son propre relevé, la validation se ferait donc toujours en deux transactions. La clôture serait de toute façon nécessaire pour la seconde.
- **Prendre le verrou de la clôture sur chaque rapport** : cela ralentirait chaque rapport pour un cas que le registre règle sans verrou.
- **Décider le retard par la date** (rapport validé après l'instant de la clôture) : `now()` est l'heure de début d'une transaction, pas celle de son engagement. Deux transactions concurrentes peuvent se croiser sans qu'aucune date ne le montre.
- **Copier le taux du jour de chaque validation** : deux relevés d'une même quinzaine convertiraient les mêmes ventes à deux taux.
