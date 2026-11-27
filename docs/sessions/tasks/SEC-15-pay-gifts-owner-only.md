# SEC-15 Primes et ajustements réservés au propriétaire
Statut : in_progress
Phase : exploitation
Dépend de : EQ-04, EQ-05
Branche : claude/project-thread-bfbfaz (fil « Sécurité »), après SEC-14

## Objectif (1 phrase)

Appliquer la règle de Charles sur l'argent : seul le propriétaire donne une prime ou un ajustement (et annule une prime), un manager ne pose qu'un malus.

## Contexte à lire (fichiers précis)

- `apps/api/src/modules/payroll/README.md` (« Les saisies d'un membre »), `domain/entries.ts`, `infra/entry-store.ts`, `infra/routes.ts`.
- `packages/db/src/schema/payroll.ts` (politiques de `bonuses`, `penalties`, `pay_adjustments`).
- `apps/web/src/screens/pay/EntriesPage.tsx`, `EntryForm.tsx`, `StatementDialog.tsx`.

## À faire (liste vérifiable)

- [x] Garde `assertGivesPayOf` : prime, annulation d'une prime et ajustement refusés à tout autre que le propriétaire (`payroll_forbidden`, « Réservé au propriétaire »), jamais pour soi.
- [x] Politiques de la base resserrées par une migration nouvelle (`owner_insert`, `owner_cancel` sur `bonuses` ; `owner_insert` sur `pay_adjustments`) ; les malus ne changent pas. Numéro de migration fixé au tour de fusion.
- [x] Tests : intégration des routes par rôle, politiques de la base par rôle, correction d'une contestation acceptée toujours écrite par le propriétaire.
- [x] Écran : un manager ne voit que « Ajouter un malus », ni « Annuler » sur une prime, ni « Ajuster » sur un relevé.
- [x] Captures de l’écran du manager validées par Charles le 20/11 (lot « paie-droits-manager »).

## Critères d'acceptation (tests, commandes, comportements observables)

- `payroll-entries.integration.test.ts` : un manager reçoit 403 sur une prime, son annulation et un ajustement, rien n'est écrit ni audité ; il pose et annule toujours un malus.
- `payroll-rls.integration.test.ts` : la base refuse ces écritures à la portée d'un manager, quel que soit le code.
- `EntriesPage.test.tsx` : le manager n'a que les malus.
- `pnpm check`, `pnpm test`, les suites d'intégration et la CI verts.

## Hors périmètre

- Les primes automatiques (paliers, objectif collectif) et la vente donnée à un chatteur : inchangées.
- Les malus : création et annulation restent au propriétaire et au manager actif.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

Écart trouvé par une relecture à froid de la paie (20/11) : le code et les politiques laissaient un manager actif donner une prime ou un ajustement. Fil Équipe (propriétaire de `payroll`) : d'accord, relit la PR.
