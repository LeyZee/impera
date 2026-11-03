# 2026-11-03 — CRM-03 lot b4c1 : le chatteur lit ses ventes et signale celle qui n'est pas à lui (serveur) — in-progress
Fait : le côté serveur du signalement (ADR 0050 § 10), selon les six points de Bilan :
- `packages/contracts` : `PaySaleSignal`, `CreatePaySaleSignalBody`, `MySales` (lignes, jours, curseur), `HeldSale.signal`, trois codes d'erreur (`pay_sale_signal_not_found`, `pay_sale_signal_conflict`, `pay_sale_signal_state_conflict`) ;
- `packages/db` : `pay_sale_signals` (migration 0079) : ajout seul, `member_insert` pour soi, déclencheur sous les politiques de l'auteur (numéro suivant, retrait d'un signalement en vigueur, quinzaine non clôturée, ligne non comptée par une clôture, ligne au relevé brouillon du membre telle qu'elle est) ;
- `payroll/domain` : `my-sales.ts` (pur : états `counted`, `signalled`, `excluded`, `removed`, geste ouvert, jours, pages) ; `sales.ts` donne au valideur le signalement du membre que le lien désigne ; `recalculation.ts` met l'heure de chaque vente au relevé, hors de `inputs_hash` (`inputsHashOf`) ;
- `payroll/infra/sale-signal-store.ts` : `GET /v1/payroll/my-sales` et `POST /v1/payroll/sale-signals` sous `withMember` et le verrou `payroll.close`, rejeu par `id`, `audit_log` ; `held-sales` rend `signal` ;
- web : les textes des trois refus dans `payRefusalText`.
Pas fait : les écrans (b4c2 : « Mes ventes lues », la fenêtre de signalement, « Signalée par … »).
Décisions :
- la lecture ne montre que le relevé et les signalements du membre : une vente en attente ou écartée qui n'a jamais été sur son relevé n'y est pas (voir Découvertes) ;
- le valideur n'a que « écarter » sur une ligne payée : un signalement sans réponse reste « signalée » jusqu'à la clôture, puis se lit sans geste ;
- un retrait n'est possible que tant que la ligne est au relevé : écartée, elle garde le signalement sans effet ;
- `days` somme toute la quinzaine à chaque page, pour que l'écran groupe par jour sans tout charger.
Découvertes : un chatteur ne voit pas ses ventes en attente hors relevé (la portée `self` ne lit pas le registre) ; une projection écrite par le recalcul le permettrait, à voir avec Bilan (noté dans la fiche).
Candidats à suppression : aucun.
Vérifié : `my-sales.test.ts` (6) ; `sales.test.ts` (2 nouveaux : signalement montré au valideur, heure hors empreinte) ; `payroll.test.ts` des contrats (2) ; `payroll-sale-signals.integration.test.ts` (6, en CI : Docker absent en local) ; référence des codes d'erreur mise à jour ; pnpm check ✓, pnpm test ✓.
