# 2026-11-03 — CRM-03 lot a : ce que la paie lit des ventes — done
Fait : `salesFeedReadsForPay`, exporté par l'index de `connectors`, lit le registre dans la transaction de l'appelant, ligne par ligne :
- les ventes d'une plage avec leurs remboursements, au jour de la vente ;
- les lignes enregistrées dans une plage, pour les tardives.

Chaque ligne porte le jour de la vente dans le fuseau donné, `recordedAt`, le net signé, la devise, et l'auteur selon le lien avec sa version. La colonne `sales_feed_chatters.link_version` (migration 0069) change quand le lien pointe ailleurs. `earningsBaseOf` (contrats) donne la base d'une vente selon la plateforme et la source.
Pas fait : la garde de bascule, `shift_feedback`, le calcul (Équipe).
Décisions : le port rend des lignes, jamais des sommes, et n'attribue rien à un shift. La paie (Équipe) le fait.
Découvertes : `tx.execute` ne passe pas un tableau JavaScript en `uuid[]` ; il faut une liste `in (…)` construite avec `sql.join`.
Candidats à suppression : aucun.
Vérifié : `pay-reads.integration.test.ts` (5 tests, Postgres 16 local) ; test de `earningsBaseOf` ; pnpm check ✓.
