# SEC-03 Limites de connexion par compte et adresse, sessions de 7 jours au plus
Statut : done
Phase : exploitation
Dépend de : ADR 0046, SEC-02
Branche : claude/project-thread-8fl2b1 (fil « Auditer et sécuriser Nirvana »)

## Objectif (1 phrase)

Les essais d'un autre ne bloquent plus le titulaire d'un compte, et aucune session ne vit plus de 7 jours (ADR 0046 § 5 et 6).

## Contexte à lire (fichiers précis)

- ADR 0046, ADR 0027 § 6, `docs/conventions/security.md` § 6.
- `apps/api/src/auth.ts`, `apps/api/src/rate-limit-store.ts`.

## À faire (liste vérifiable)

- [x] Connexion : 10 essais par quart d'heure pour un compte depuis une adresse ; 100 par quart d'heure pour un compte toutes adresses ; un appareil de confiance hors de ce plafond ; les deux refusent quand les compteurs sont hors d'atteinte.
- [x] Les mêmes limites sur la vérification du code.
- [x] Session refusée à la requête suivante quand elle a plus de 7 jours, quel que soit l'usage.
- [x] `security.md` § 6 mis à jour.

## Critères d'acceptation (tests, commandes, comportements observables)

- Intégration : 10 échecs depuis une adresse n'empêchent pas la même connexion depuis une autre ; une session vieillie de 7 jours reçoit 401.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Alertes (SEC-04).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Trois limites sur la connexion : 20 par minute et par IP (inchangée), 10 par quart d'heure pour un compte depuis une adresse, 100 pour un compte toutes adresses. Les deux dernières partagent leurs limiteurs avec le code (clés `sign-in:<e-mail>` et `code:<compte>`, comptées à part).
- Appareil de confiance hors du plafond de 100 : la route cherche la ligne `trust-device-…` que nomme le cookie, non expirée, du compte de l'e-mail. La signature reste vérifiée par Better Auth avant de sauter le code.
- Code : le compte de l'étape est lu dans la ligne `verification` que nomme le cookie `two_factor`. Le verrouillage du plugin (10 codes faux de suite, par compte) reste en place.
- Durée absolue : `sessionOf` remplace `getSession` dans `currentUser`, `requireRecentLogin` et la confirmation ; la session trop vieille est supprimée. `createRequireRecentLogin` prend maintenant la base.
