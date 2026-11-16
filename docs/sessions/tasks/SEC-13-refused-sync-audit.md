# SEC-13 Une « Sync » refusée laisse sa ligne au journal d'audit
Statut : done
Phase : exploitation
Dépend de : SEC-12
Branche : claude/project-thread-bfbfaz (fil « Sécurité »)

## Objectif (1 phrase)

Garder au journal d'audit chaque « Sync » refusée, comme `security.md` le demande pour une « Sync » acceptée.

## Contexte à lire (fichiers précis)

- `apps/api/src/modules/connectors/application/sessions.ts`, `infra/db/account-store.ts`, `domain/ports.ts`.
- `docs/conventions/security.md` (journal d'audit), découverte du journal de SEC-12.

## À faire (liste vérifiable)

- [x] `recordRefusedSession` : action `connector.session_refused`, le compte, le motif (`owner_conflict` ou `member_conflict`), l'utilisateur.
- [x] Écrite hors de la transaction refusée, que le refus vienne de l'application ou de la contrainte.
- [x] Si la ligne ne peut pas être écrite, le refus reste la réponse et le journal applicatif le dit (relecture Bilan).
- [x] Test d'intégration ; README du module.

## Critères d'acceptation (tests, commandes, comportements observables)

- `connectors.integration.test.ts` : chaque refus laisse une ligne avec son motif et son auteur ; la ligne ne porte aucune valeur de session ni identifiant de plateforme.
- `pnpm check`, `pnpm test`, les suites d'intégration et la CI verts.

## Hors périmètre

- Montrer ces lignes dans un écran.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

Forme demandée par Bilan à la relecture de SEC-12.
