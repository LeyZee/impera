# 2026-11-03 — CRM-03 lot b1 : la paie compte les ventes lues (règles pures) — in-progress
Fait : `payroll/domain/sales.ts` dit, pour chaque ligne du registre des ventes, à qui elle est et quelle quinzaine la compte :
- elle compte pour un membre si son lien pointe vers lui, s'il était en poste ou dans sa marge d'accès à l'heure de la vente sur ce compte (sans marge après un shift arrêté en cours), si la quinzaine de la vente est en `platform_net` et si son statut est connu ; `refund_asked` compte encore ;
- l'agent ou l'absence de chatteur : à personne ; un chatteur non relié, un membre hors poste, un statut inconnu, le remboursement d'une vente jamais payée sur ce net : en attente, pour personne ;
- une quinzaine clôturée compte exactement les ventes que sa clôture a enregistrées, pour le membre et la version du lien vus alors ; une quinzaine ouverte compte celles qu'aucune clôture n'a enregistrées, la première ouverte aussi les tardives ; avant toute clôture, une vente d'une quinzaine antérieure bloque la clôture comme un rapport ;
- un remboursement va au membre que sa vente a payé, même si le lien pointe ailleurs depuis.

Le recalcul ajoute une ligne `platform_net` par compte et devise (brut = somme des nets, TVA et commission de la plateforme à 0), avec les ventes qu'elle compte. La clôture rend les ventes comptées (`countedSales`). Le moteur met la base dans sa clé de doublon.
Pas fait : la lecture des ventes, des shifts et des sources (lot b2), la migration du registre des ventes comptées et l'écriture à la clôture (b2), la décision du valideur (b3), les libellés de l'annexe et des écrans (b4).
Décisions :
- les tardives passent par un registre des ventes comptées, sur le modèle du registre des rapports de l'ADR 0032, plutôt que par une date : un changement de lien après une clôture ne paie jamais deux fois ;
- un remboursement arrivé après la clôture de sa vente va dans la première quinzaine ouverte, même si le relevé de la vente est encore un brouillon, parce que le net de l'équipe est figé à la clôture (lecture du § 7 de l'ADR 0050) ;
- le remboursement d'une vente d'avant le registre ou d'avant la bascule reste en attente, sans déduction, en attendant la réponse de Charles (réversible) ;
- les champs `base` et `sales` d'une ligne de relevé sont absents hors ventes : le contenu et l'`inputs_hash` des relevés existants ne changent pas (test de référence de la paie vert).
Découvertes : un remboursement d'un membre parti suit le même chemin qu'un rapport tardif de membre parti ; à vérifier en b2 avec un test d'intégration.
Candidats à suppression : aucun.
Vérifié : 20 tests unitaires nouveaux (`sales.test.ts`), 160 tests de la paie ; `payroll-reference`, `payroll`, `payroll-validation`, `payroll-periods`, `payroll-departure`, `payroll-rules` en intégration (Postgres 16 local, 48 tests) ; pnpm check ✓.
