# SEC-08 Lien d'extension : mot de passe et code redemandés à la création ; ADR 0087 proposée
Statut : done
Phase : exploitation
Dépend de : SEC-07, ADR 0046
Branche : claude/project-thread-bfbfaz (fil « Corriger les failles de l'audit sécurité »)

## Objectif (1 phrase)

Faire de la création d'un lien d'extension une action sensible au sens de l'ADR 0046 § 3, et proposer l'ADR 0087.

## Contexte à lire (fichiers précis)

- `docs/conventions/security.md` §6, `docs/adr/0046-*.md` § 3, `apps/api/src/modules/trends/infra/http/routes.ts`, `apps/web/src/security/ExtensionLinksPanel.tsx`.

## À faire (liste vérifiable)

- [x] `POST /v1/trends/extension-links` demande une confirmation de moins de 10 minutes, quel que soit le rôle.
- [x] L'écran « Relier l'extension » redemande le mot de passe et le code (ou un geste sur une clé d'accès), puis relie.
- [x] Captures Nuit/Jour, PC/téléphone.
- [x] ADR 0087 écrite en `proposed` ; aucun code avant l'accord de Charles.

## Critères d'acceptation (tests, commandes, comportements observables)

- `trends.integration.test.ts` : 403 `reauthentication_forbidden` quand la confirmation a plus de 10 minutes ; lire et délier restent ouverts.
- `ExtensionLinksPanel.test.tsx` : le refus ouvre la confirmation, une seule paire de boutons, puis le code de liaison s'affiche.
- `pnpm check`, `pnpm test` et la CI verts.

## Hors périmètre

- Le code de l'ADR 0087 (rôle de service) : après « ok 0087 ».
- Bornes du message entrant et plafond par conversation : attendent le choix de Charles.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- La règle vaut pour tous les rôles et pas seulement le propriétaire : un lien est un accès qui dure, et relier un navigateur est rare (au plus une fois par mois et par navigateur).
- Juste après une connexion, rien n'est redemandé : la connexion compte comme confirmation pendant 10 minutes.
- L'extension ne crée jamais de lien elle-même ; elle n'est pas touchée.

## Résultat

Un lien d'extension ne se crée plus sur une session ancienne sans le mot de passe et le code. ADR 0087 en attente de l'accord de Charles.
