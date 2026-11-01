# 0035. Paie : une saisie verrouille sa quinzaine et chacune des suivantes

Statut : accepted (Charles, 28/10/2026 17h23, « ok 0035 »)
Date : 2026-10-28
Complète : ADR 0032 § Verrous (les saisies d'un membre)

## Contexte

L'ADR 0032 (acceptée le 28/10) pose deux verrous, toujours dans cet ordre : `payroll.close`, global, puis (membre, quinzaine), le verrou d'EQ-03. Une prime, un malus, une annulation ou un ajustement prend le second « sur la quinzaine qu'ils touchent », et aucune de ces écritures ne prend `payroll.close`.

Le lot de l'application (EQ-04, lot 3c) montre que cela laisse deux courses ouvertes.

**Une validation plus récente du même membre.** Une quinzaine est fermée pour un membre dès qu'un de ses relevés plus récents est validé (migration 0028). Théo n'a rien en p, et son relevé de p+1 est un brouillon. Une prime pour Théo sur p prend (Théo, p). Au même moment, la validation de son relevé de p+1 prend (Théo, p+1). Les deux verrous sont différents, donc aucune transaction n'attend l'autre. La validation ne voit pas la prime, pas encore engagée, et ne demande donc aucun relevé pour p. La prime passe la garde des quinzaines fermées, qui lit en READ COMMITTED, et s'engage sur une quinzaine que la validation vient de fermer. Elle ne sera comptée dans aucun relevé, sans que rien ne le signale.

**La toute première clôture.** Elle ferme pour toujours toutes les quinzaines qui la précèdent, pour toute l'équipe (migration 0029, `pay_period_closed`). Une saisie sur une de ces quinzaines, concurrente de la première validation, passe la garde de la même façon et reste sur une quinzaine fermée.

## Décision

**Une prime, un malus, une annulation ou un ajustement prend le verrou (membre, quinzaine) sur la quinzaine qu'il touche et sur chacune des suivantes, jusqu'à la quinzaine en cours.** Les verrous se prennent par quinzaine croissante, puis par membre croissant si une écriture touche plusieurs membres. La quinzaine en cours est celle que le serveur calcule dans le fuseau de l'agence, jamais une date venue du client. Une quinzaine après celle en cours n'est pas finie : rien ne peut la valider.

Les deux transactions se voient donc toujours :

- une validation d'une quinzaine plus récente du membre attend l'écriture et la voit. Elle demande d'abord le relevé que la quinzaine de l'écriture doit au membre (`commission_statement_order_conflict`) ;
- une écriture qui arrive pendant une validation l'attend, puis elle est refusée si sa quinzaine est fermée pour le membre (`pay_period_closed_conflict`).

**Tant qu'aucune quinzaine n'est clôturée, ces écritures prennent aussi `payroll.close`, avant leurs verrous (membre, quinzaine).** La première clôture voit l'écriture, ou l'écriture voit la clôture. Dès qu'une quinzaine est clôturée, elles ne le prennent plus.

**Une saisie refuse sans verrou une quinzaine déjà fermée pour le membre ou antérieure à son arrivée** (`pay_period_closed_conflict`). La fermeture ne recule jamais : un relevé validé ne redevient pas brouillon, et une clôture ne s'efface pas. Une quinzaine lue fermée avant les verrous l'est donc encore sous eux, et rien n'est dû à un membre avant son arrivée. Le nombre de verrous reste ainsi celui des quinzaines ouvertes du membre jusqu'à la quinzaine en cours : une date ancienne envoyée par le client ne fait jamais prendre des centaines de verrous, qui rempliraient la table partagée de Postgres pour toute la base. Ce qui passe ce contrôle est revérifié sous les verrous.

L'ordre de l'ADR 0032 ne change pas : `payroll.close` passe toujours avant (membre, quinzaine), jamais après. Il n'y a donc pas d'interblocage.

## Conséquences

Positives :
- aucune prime, aucun malus, aucune annulation et aucun ajustement ne s'écrit sur une quinzaine qui se ferme au même moment ;
- la règle tient dans une fonction pure (`periodsToLock`), que la saisie applique avant toute lecture.

Négatives :
- une saisie prend un verrou par quinzaine ouverte du membre, de la sienne jusqu'à aujourd'hui, jamais plus : une ou deux d'ordinaire, davantage avant la première clôture, où toutes les quinzaines depuis l'arrivée du membre sont ouvertes ;
- avant la première clôture, les saisies passent l'une après l'autre avec les validations, les recalculs et les règles. Cela ne dure que jusqu'à la première paie, ou jusqu'à l'import d'Imperium (EQ-07).

Tests du lot de l'application, contre une base réelle :
- une prime sur une quinzaine où le membre n'avait rien, contre la validation d'une quinzaine plus récente du même membre : la validation attend, puis demande le relevé de la quinzaine de la prime ;
- une prime contre une validation du même membre : la prime attend le verrou, puis elle est refusée ;
- tant qu'aucune quinzaine n'est clôturée, une saisie attend le verrou de la clôture, et un rejeu rend la même prime ;
- une prime ou un malus sur une quinzaine déjà fermée pour le membre est refusé sans attendre le verrou qu'une autre transaction tient sur cette quinzaine.

## Alternatives rejetées

- **Faire prendre à la validation les verrous de toutes les quinzaines encore ouvertes du membre** : elle ne sait pas sur quelle quinzaine ancienne une écriture pourrait tomber, jusqu'à l'arrivée du membre. L'écriture, elle, connaît sa quinzaine de départ.
- **Prendre `payroll.close` pour toute saisie** : chaque prime attendrait chaque recalcul de toute une quinzaine, même quand aucune clôture n'est en jeu.
- **Revérifier après coup, dans un déclencheur, qu'aucune validation plus récente n'a été engagée** : en READ COMMITTED, le déclencheur ne voit pas une validation pas encore engagée. Il faudrait passer en SERIALIZABLE et rejouer, pour un cas qu'un verrou règle.
