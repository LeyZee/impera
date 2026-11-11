# REC-PAIE-01 Recette paie : compte Reveal d'une vente en attente, comptes retirés et membres partis
Statut : done
Phase : exploitation
Dépend de : CRM-03, ADR 0076, ADR 0072
Branche : task/rec-paie-01-held-sale-account-and-removed-accounts

## Objectif (1 phrase)

Corriger les anomalies 4, 5, 6 et 8 de la recette de la paie du 11/11/2026 (données inventées) : le valideur sait quel compte Reveal a fait une vente non reliée, un compte retiré de Reveal n'est ni compté ni invité, et un membre parti se relie à son compte Reveal.

## Contexte à lire (fichiers précis)

- ADR 0076 (équipe importée depuis Reveal), ADR 0072 (relevé final d'un membre parti), ADR 0050 § 5.
- `apps/api/src/modules/connectors/domain/team-import.ts`, `apps/api/src/modules/payroll/domain/sales.ts`.
- `apps/web/src/screens/pay/HeldSalesPanel.tsx`, `apps/web/src/screens/team/RevealPage.tsx`, `apps/web/src/screens/team/reveal.ts`.

## À faire (liste vérifiable)

- [x] Anomalie 5 : `HeldSaleSchema.platformChatterId` (`null` pour une vente faite par personne, un abonnement par exemple), rempli depuis `platform_sales.platform_chatter_id` ; la ligne dit « chatteur non relié · Prénom Nom » d'après la liste d'Équipe › Reveal, sinon « compte Reveal non relié ».
- [x] Anomalie 6 : « relie-le dans Équipe › Reveal » partout où il s'agit du lien d'un chatteur (ventes en attente, rapports, Dashboard).
- [x] Anomalie 8 (décision de Charles, 11/11) : un compte retiré de Reveal reste listé, hors de « N nouveaux chatteurs », sans proposition, sans « Inviter » ni présélection ; la ligne dit « Retiré de Reveal le … ». L'invitation le refuse (422).
- [x] Anomalie 4 (décision de Charles, 11/11) : un membre parti se relie. Même e-mail : proposition de lien décochée, marquée « parti le … », jamais une invitation ; la liste des choix montre les membres partis, « Nom (parti) » ; le lien est accepté par le cas d'usage (la base ne le refusait pas).

## Critères d'acceptation (tests, commandes, comportements observables)

- Tests de domaine `team-import.test.ts` (proposition, actions, compte retiré, membre parti) et intégration `sales-feed-team.integration.test.ts`, `payroll-sale-decisions.integration.test.ts`.
- Tests web : `held-sales.test.ts`, `PeriodPage.test.tsx`, `reveal.test.ts`, `RevealPage.test.tsx`.
- `pnpm check` et `pnpm test` verts.

## Hors périmètre

- Les règles de paie d'un membre parti (ADR 0072) : inchangées.
- Les liens des modèles, qui restent dans Réglages › Ventes.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Une proposition vers un membre parti n'est pas cochée d'avance : le lecteur confirme, car le lien fait payer ses ventes d'avant le départ.
- Un compte retiré garde la proposition du membre de son e-mail (parti ou non) ; sans elle, aucune.
- Un membre parti n'est proposé que sur son e-mail, jamais sur son nom ; un membre encore là passe avant un membre parti de même e-mail.
- La paie ne coupe pas les ventes d'un membre parti par la date de son départ : une vente d'après son départ n'a pas de shift (un membre parti n'en reçoit plus), donc elle attend « hors poste » une décision du valideur. Pas de test ajouté.
