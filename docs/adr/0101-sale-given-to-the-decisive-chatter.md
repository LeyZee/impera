# 0101. Une vente donnée, entière ou partagée, au chatteur qui a été décisif

Statut : accepted (« ok 0101 » de Charles le 13/11/2026, 0 h 07 ; amendement « partager une vente » accepté par « ok phrases 0101 » le 13/11/2026, 0 h 57 ; demande de Charles du 11/11/2026, 18 h 25, fil Équipe ; « oui vas y » du 12/11/2026, 23 h 40 ; numéro attribué par le coordinateur ; relu par Bilan le 12/11, ses quatre précisions reprises)
Date : 2026-11-12
Amende : 0050 § 5 (une décision donne la vente à l'auteur Reveal ou à personne) et la phrase « Never another member » de la décision sur une vente (CRM-03 lot b3).
Précise : 0025 (marge d'accès), 0043 § 7 (un chatteur ne voit jamais les chiffres d'un autre), 0092 § 1 (valeur d'un chatteur et de l'agent).

## Contexte

Charles, le 11/11 : une vente revient par défaut au chatteur qui a envoyé le média payant avec son prix, même s'il est parti depuis. Mais si un autre chatteur, ou l'IA, a été décisif ensuite (il a fait la relation, il a convaincu le fan de payer), la vente lui revient. Une vente qui revient à l'IA ne revient à personne.

Reveal donne déjà le premier cas : un PPV va au chatteur qui l'a envoyé, un pourboire ou un message payant au dernier membre qui a écrit au fan avant le paiement. Le valideur sait aussi le troisième : « Écarter » met la vente à personne. Le deuxième n'existe pas. Une décision compte la vente pour le membre que le lien donne, ou pour personne, jamais pour un autre membre. Aujourd'hui, un manager qui veut récompenser le chatteur décisif doit passer par une prime à la main, qui ne suit ni les paliers ni les remboursements.

L'API ne dit pas qui parlait au fan au moment de l'achat : une vente ne porte ni conversation ni message (0050, Conséquences). Le seul fait sûr est le planning : qui était en poste sur ce compte à l'instant de la vente.

## Décision

1. **« Donner à … »**, une décision de plus sur une vente, à côté de « Compter » et « Écarter ». Elle donne la vente à un autre membre, entière, ou partagée avec son auteur (règles 11 à 17). Elle vaut pour un PPV, un pourboire ou un message payant dont l'auteur Reveal est un membre ou l'agent : une vente envoyée par l'agent peut donc être donnée au chatteur qui a convaincu ensuite (la règle 8 ne vaut que pour une vente qui reste à l'IA). Les ventes sans chatteur (abonnements, Mass DM, liens de paiement) restent à personne.
2. **Seulement à un membre en poste à l'instant de la vente**, sur ce compte, marge d'accès comprise (0025), et autre que l'auteur. C'est lui qui avait le fan quand il a payé. La liste du choix ne propose que ces membres ; s'il n'y en a aucun, « Donner à … » n'apparaît pas.
3. **Décidée par le valideur** (le propriétaire ou un manager actif), jamais si l'un des deux membres est lui-même. **La note est obligatoire** : pourquoi ce membre a été décisif (500 caractères au plus).
4. **Tant qu'aucune clôture n'a compté la vente.** Elle se reprend ou se change comme les autres décisions (« Retirer la décision »). Une vente qu'une clôture a comptée ne bouge plus. Elle est refusée aussi quand le membre qui la recevrait est parti et que son relevé final est validé (ADR 0072), comme une vente en attente d'un membre parti.
5. **Elle compte pour le membre qui la reçoit**, à son taux, dans la quinzaine de la vente. Si cette quinzaine est clôturée, ce qui n'arrive qu'à une vente qu'aucune clôture n'a comptée, donc en attente (règle 4), elle compte dans la première quinzaine non clôturée, comme une vente en attente comptée (0050 § 5), et entre dans les paliers de cette quinzaine-là. Ses remboursements suivent la décision **par la vente d'origine**, jamais par leur propre `chatterId` : l'auteur ne paie jamais le remboursement d'une vente donnée. Elle compte dans le net de l'équipe comme toute vente d'un membre.
6. **Les deux membres la voient sur leur relevé**, avec la note : l'auteur lit « Donnée à <prénom> », le receveur « Reçue de <prénom> ». Ils ne voient rien d'autre l'un de l'autre, ni total ni classement (0043 § 7).
7. **Un chatteur ne réclame pas une vente dans Impera** : il ne voit pas les ventes des autres (0043 § 7). Il le dit à son manager. L'auteur peut déjà signaler « ce n'est pas ma vente » sur son relevé, et le valideur y répond par « Donner à … ».
8. **L'IA décisive.** « Écarter » demande sa raison : « l'IA a été décisive » ou « autre raison ». La première compte la vente pour l'agent dans le Dashboard (« Qui a vendu », valeur de l'agent de 0092 § 1), jamais en paie : l'IA n'est personne.
9. **Une seule lecture de l'attribution.** À qui revient une vente (l'auteur, le receveur d'un « Donner à … », l'agent quand l'IA a été décisive, ou personne) vient d'une seule lecture, exportée par la paie, que lisent la paie, « Qui a vendu » et la valeur d'un chatteur (0092 § 1). Le Dashboard et la paie ne peuvent donc pas diverger. Le registre des ventes (0078) reste tel qu'il est lu : brut, jamais réécrit.
10. **Rien ne s'efface** : chaque décision s'ajoute à l'historique de la vente (déjà le cas), et le journal garde qui a décidé, le membre qui reçoit et la note. Le propriétaire voit qui a donné quoi, à qui et pourquoi.

## Amendement du 13/11/2026 : partager une vente (accepté, « ok phrases 0101 »)

Demande de Charles du 13/11/2026, 0 h 07 : pouvoir trancher une dispute entre deux chatteurs en partageant une vente, 50/50 ou un autre pourcentage, par un manager ou par lui.

11. **« Donner à … » propose « Toute la vente » (par défaut) ou « Partager ».** « Partager » propose 50/50 en un geste, ou un autre partage par pas de 10 % (de 90/10 à 10/90) sur une seule barre.
12. **Entre deux personnes, jamais trois** : l'auteur Reveal et un membre en poste à l'instant de la vente (règle 2). Une vente de l'agent ne se partage pas : elle se donne entière ou reste à l'IA.
13. **Chacun compte sa part du net**, à son taux et dans ses paliers (sa part, jamais la vente entière). La part du receveur se calcule une seule fois, arrondie au centime, et l'auteur reçoit le reste : la somme des parts redonne toujours le net de la vente au centime (test d'invariant sur des montants impairs, de 10 % à 90 %).
14. **Un remboursement, même partiel, se partage avec les mêmes parts**, par la vente d'origine (règle 5), avec la même méthode : part du receveur arrondie, reste à l'auteur. Si la quinzaine de l'un est déjà clôturée, sa part du remboursement suit la règle existante (première quinzaine non clôturée), indépendamment de l'autre.
15. **Les deux voient « Partagée avec <prénom> : 60 % »** et la note sur leur relevé. Les règles 3, 4, 6 et 10 valent pour un partage comme pour un don entier.
16. **Le Dashboard répartit le chiffre selon les parts** (règle 9). En nombre de ventes, elle compte une fois, pour le membre qui a la plus grande part (l'auteur à 50/50) : le nombre de ventes de l'équipe reste celui de Reveal.
17. **Surveillance** : le propriétaire voit le nombre de partages par manager et par mois. Le risque d'un partage par réflexe (« couper la poire en deux ») est la raison du défaut « Toute la vente ».

Le registre des ventes (0078) n'est jamais touché : le partage ne vit que dans la décision. La vérification à deux sources (0050 § 8) et 0084, qui comparent le registre brut aux statistiques de Reveal, ne bougent donc pas. Dans l'export comptable, une vente reste une ligne avec sa référence Reveal, et les parts sont des sous-lignes qui renvoient à elle : l'export ne compte jamais deux ventes.

Coût : une vente partagée s'inscrit sur deux relevés. Le registre des ventes d'une clôture (`pay_period_sales`, une ligne par vente aujourd'hui) prend donc une ligne par membre, avec sa part : sa clé change dans la migration 0175 (une migration nouvelle, rien de réécrit). Les remboursements après clôture se retirent de chacun selon sa part. La PR de 0101 grossit d'environ moitié.

Cet amendement remplace l'alternative d'abord rejetée « Partager une vente entre deux chatteurs ».

## Conséquences

- Positives : la règle de Charles est entière dans la paie ; un manager n'a plus besoin d'une prime à la main, et une vente donnée suit paliers et remboursements.
- Négatives : la paie devient discutable sur ces ventes (« c'est moi qui l'ai convaincu »). La règle 2, la note obligatoire et la visibilité des deux côtés sont là pour ça. Une migration (0175) : la décision gagne `give`, le membre qui reçoit et sa part (en points de base, 10 000 pour toute la vente), « Écarter » gagne sa raison, et le registre d'une clôture prend une ligne par membre.
- À surveiller : le nombre de ventes données par mois et par manager, visible du propriétaire. Si un membre en reçoit souvent d'un même auteur, c'est à regarder.
- Sans effet sur la vérification à deux sources (0050 § 8) ni sur 0084 : elle compare des totaux par compte et par jour, et une vente donnée ne change pas de compte.

## Alternatives rejetées

- **Laisser le chatteur réclamer une vente** : il faudrait lui montrer les ventes des autres (contraire à 0043 § 7), et chaque réclamation devient un conflit à arbitrer.
- **Donner à n'importe quel membre, même pas en poste** : impossible à vérifier, ouvre la porte aux arrangements.
- **Une prime à la main** (aujourd'hui) : ne suit ni les paliers ni les remboursements, et ne laisse pas de trace sur la vente.
