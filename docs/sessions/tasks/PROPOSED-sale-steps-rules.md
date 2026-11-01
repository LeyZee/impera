# Déroulé d'un script : les règles de Desirely qui collent à notre méthode
Statut : proposed (ID à donner par Charles ; à fondre dans P6-01 et P6-02 s'il le préfère)
Phase : 6
Dépend de : P6-01 (catalogue), P6-02 (après une offre), médiathèque (ADR 0030)
Branche : task/<id>-sale-steps-rules

## Objectif
Tenir dans le code, étape par étape, le rythme et les garde-fous d'une vente par script que Desirely a éprouvés et qui ne contredisent pas la méthode (pas de négociation, pas de remise, Reveal fait foi).

## Contexte à lire
`P6-01-sales-catalog.md`, `P6-02-after-offer.md`, `apps/api/src/modules/agent/domain/policy.ts` (`offerDecision`), méthode de chatting §2.3 à §3 (hors dépôt), `docs/reference/desirely-analysis.md` (§ Scripts et ventes).

## Règles à porter (reformulées)
1. **Rythme entre deux étapes** : un nombre de messages échangés avant de proposer l'étape suivante, réglé par script (Desirely : de 1 à 10, conseil 1 à 2, 3 au plus). Chez nous : valeur par défaut 2 dans la persona (`strategies.script_launch`), surchargeable par script ; la politique ne propose pas l'étape suivante avant.
2. **Un seul PPV verrouillé à la fois** : tant que le bundle envoyé n'est pas débloqué, aucun autre ne part ; l'agent continue de parler de celui-là.
3. **Un achat n'existe que confirmé par la plateforme** : « c'est payé » ne débloque rien (la garde `payment_lie` couvre déjà la voix ; il faut la même règle dans la politique, lue sur `sale_detected`).
4. **L'étape suivante se mérite** : pas d'étape N+1 tant que l'étape N n'est pas achetée.
5. **Vente qui s'enlise** : en pleine vente, trois heures sans échange font revenir la conversation au relationnel ; au retour du fan, elle reprend la relation, pas le PPV en attente.
6. **Description de scène** : chaque étape a une description de la scène (tenue, couleurs, lieu, position, ce qui se passe) ; la scène prime sur la persona quand elles divergent (robe bleue dans la scène, couleur préférée noire dans la fiche : elle parle de la robe bleue). Une étape sans description n'est pas proposable.
7. **Choix du script** : parmi les scripts actifs, jamais reçus par ce fan, dont tous les médias existent sur son compte et dont aucun n'a été vu par lui, du bon moment (Jour / Nuit), le plus récent d'abord (un nouveau contenu passe en tête).
8. **Catalogue court** : avertissement au propriétaire quand une créatrice a moins de quatre scripts actifs, et alerte « plus de script » par fan ; l'agent continue la relation (contrairement à Desirely, qui coupe la conversation).
9. **Après un PPV sans réponse** : le playbook enchaîne un renforcement court juste après l'envoi puis jusqu'à trois relances à quelques minutes d'écart (p. 54 et 55 du PDF). Chez nous : le renforcement, puis une seule relance, rien après un refus (chouinage borné de la méthode) ; à calibrer au playground. Cette relance reste distincte de la réponse différée de P3-11, qui fait déjà un seul « tu es revenu ? » : jamais deux messages de ce genre à la suite, quelle que soit la règle qui les déclenche.

## Ce qu'on ne reprend pas
Prix réduit, négociation bornée, remise progressive après sept messages sans achat, « valeur ajoutée » ou bonus pour faire passer le prix, approche culpabilisante : contraires à la méthode §3 et §4 (garde `discount`, `guilt_trip`).

## À faire
- [ ] Règles pures dans `policy.ts` et tests (une règle, un test) ; champ `messages_before_next_step` dans le catalogue de P6-01.
- [ ] Évals : fan qui dit avoir payé sans achat, fan qui revient trois heures après un PPV, fan qui demande la couleur de la tenue.

## Critères d'acceptation
- `pnpm check`, `pnpm test` verts ; chaque règle ci-dessus a son test.

## Hors périmètre
L'éditeur de scripts, les prix eux-mêmes, OnlyFans.

## Notes de session
