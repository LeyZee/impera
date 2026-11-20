# SEC-15 Durée d'une session selon le rôle : 48 h sans activité pour le propriétaire, 12 h pour les autres, 7 jours au plus
Statut : in_progress
Phase : exploitation
Dépend de : ADR 0046, SEC-03
Branche : task/sec-session-length-by-role

## Objectif (1 phrase)

La session du propriétaire tient 48 heures sans activité, celle de tous les autres rôles 12 heures comme avant, toutes 7 jours au plus après leur ouverture (décision du propriétaire, validée par la relecture de sécurité).

## Contexte à lire (fichiers précis)

- ADR 0046 (§ 3 confirmation récente, § 6 durée absolue), `docs/conventions/security.md` § 6.
- `apps/api/src/auth.ts` (`createAuth`, `sessionOf`, `createRequireRecentLogin`), `apps/api/src/security-settings.ts`.
- Better Auth 1.7.7 : `getSession` (`dist/api/routes/session.mjs`), crochets de base (`dist/db/with-hooks.mjs`).

## À faire (liste vérifiable)

- [x] Durées dans un seul fichier, `apps/api/src/session-lifetime.ts` : 12 h, 48 h, 7 jours, et `LONG_IDLE_ROLES` (le propriétaire seul) ; un rôle qui ne se valide pas reçoit la durée courte.
- [x] `expiresIn` de Better Auth à 48 h ; les 12 h des autres rôles appliquées par le serveur, à la prolongation (crochet `session.update.before`) et à chaque requête (`sessionOf`) ; la session finie est supprimée.
- [x] Le cookie de session renouvelé avec la session (`requireRole`, `GET /v1/session`).
- [x] Réglages › Sécurité : la liste de ses sessions et le compte par compte ne montrent que les sessions vivantes selon le rôle.
- [x] Les sessions ouvertes avant le changement (expiration à 12 h) restent valables et passent aux nouvelles durées à leur prolongation.
- [x] `security.md` § 6 et les commentaires du code mis à jour.
- [ ] Suites d'intégration lancées avec Docker (écrites et typées, pas lancées : Docker absent de la session).
- [ ] Décision sur la durée de la créatrice (aujourd'hui courte) ; l'allonger revient à ajouter `creator` à `LONG_IDLE_ROLES`.

## Critères d'acceptation (tests, commandes, comportements observables)

- Unitaire (`session-lifetime.test.ts`) : propriétaire 47 h gardée, 49 h finie ; opérateur, créatrice et rôle inconnu 11 h gardée, 13 h finie ; toute session finie à 7 jours et 1 minute, même utilisée.
- Intégration (`session-lifetime.integration.test.ts`) : les mêmes seuils sur le vrai chemin (manager, chatteur, créatrice ; ligne supprimée) ; une session finie n'est pas ranimée par une route que Better Auth lit lui-même ; une ligne d'avant le changement reste valable ; le cookie est renouvelé (`Max-Age=172800`) ; une session du propriétaire de 6 jours, utilisée sans arrêt, ne passe pas `requireRecentLogin` ; une session finie disparaît de la liste des sessions.
- Inchangés et toujours verts : changement de mot de passe, remise à zéro du code et départ ferment toutes les sessions (`invitation-links`, `second-factor`, `ops`, `team-members`).
- `pnpm check`, `pnpm test`, les suites d'intégration et la CI verts.

## Hors périmètre

- Modifier l'ADR 0046 (acceptée).
- La durée de la créatrice (décision attendue).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Better Auth prolonge la session (`updated_at` mis à maintenant) avant de la rendre : `sessionOf` seul verrait une session inactive depuis 13 h comme utilisée à l'instant. D'où le crochet `session.update.before`, qui lit la session que `getSession` vient de mettre dans son contexte (son `updated_at` d'avant, le rôle du compte), refuse la prolongation d'une session finie et la supprime ; Better Auth répond alors comme sans session (401 dans `auth.api.getSession`, `null` dans ses propres routes). Sans ce crochet, les options de connexion par clé d'accès, lues sans garde de notre part, prolongeraient une session finie. Comportement vérifié sur Better Auth 1.7.7 avec l'adaptateur mémoire.
- Le cookie de session porte un `Max-Age` égal à `expiresIn`, posé à la connexion ; `sessionOf` passait par `auth.api.getSession` et jetait le `Set-Cookie` de la prolongation : le navigateur oubliait la session 12 h après la connexion, même utilisée. Le cookie est maintenant renouvelé par `requireRole` et `GET /v1/session`.
- La durée de 48 h contredit le « 12 heures sans activité » de l'ADR 0046 § 6 pour le propriétaire ; l'ADR n'est pas modifiée (consigne), à acter par une ADR qui l'amende si Charles le veut.
