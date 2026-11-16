# SEC-12 Une identité de plateforme n'appartient qu'à un compte : la « Sync » d'une autre créatrice est refusée dès la première
Statut : done
Phase : exploitation
Dépend de : P2-01
Branche : claude/project-thread-bfbfaz (fil « Sécurité »)

## Objectif (1 phrase)

Tenir dès la première « Sync » la règle que `sessions.ts` énonce déjà : la session d'une créatrice ne se pose jamais sur le compte d'une autre.

## Contexte à lire (fichiers précis)

- `apps/api/src/modules/connectors/application/sessions.ts`, `infra/db/account-store.ts`, `domain/errors.ts` (`SessionOwnerConflict`).
- `packages/db/src/schema/tenancy.ts` (`platform_accounts`), `apps/api/src/modules/connectors/README.md`.

## À faire (liste vérifiable)

- [x] Migration 0213 : `platform_accounts.session_owner`, unique par plateforme.
- [x] `storeSession` écrit `session_owner` à chaque « Sync » ; la contrainte refusée devient `SessionOwnerConflict`.
- [x] `sessions.ts` refuse aussi une session dont le relevé des ventes lie le modèle à un autre compte.
- [x] Test d'intégration ; docs (`data-model.md`, README du module).

## Critères d'acceptation (tests, commandes, comportements observables)

- `connectors.integration.test.ts` : la même session synchronisée sur le compte d'une autre créatrice répond 409 `connector_session_conflict` et rien n'est gardé ; son propre compte la reprend ; une session expirée garde le compte à elle ; un modèle que le relevé lie à un autre compte est refusé.
- `pnpm check`, `pnpm test`, les suites d'intégration et la CI verts.

## Hors périmètre

- Le popup de l'extension (montrer la créatrice vue avant de confirmer) : fil Extension, avec captures.
- Remplir `session_owner` des comptes synchronisés avant la migration : il se pose à leur « Sync » suivante.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- La comparaison existante ne joue que s'il y a déjà une session gardée ou un lien du relevé pour ce compte. La contrainte en base répond dans les autres cas, et pour deux « Sync » simultanées.
- L'identité est gardée quand la session expire : le compte reste celui de la même créatrice.
- Les tests qui synchronisaient le même modèle fictif sur plusieurs comptes ont maintenant un modèle par compte.

## Résultat

Un mauvais clic dans le popup ne peut plus lier la session d'une créatrice au compte d'une autre : la base le refuse.
