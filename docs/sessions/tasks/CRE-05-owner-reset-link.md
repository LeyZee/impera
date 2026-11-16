# CRE-05 « Mot de passe oublié » sans Telegram : le lien que le propriétaire crée
Statut : done
Phase : exploitation
Dépend de : SEC-05 (lot 3), EQ-10, CR-02, ADR 0068, ADR 0076 § 3
Branche : task/cre-05-owner-reset-link

## Objectif (1 phrase)

Qu'une créatrice, ou un chatteur sans Telegram lié, ne tombe plus sur une impasse à « Mot de passe oublié » (recette CRE-05 et CHT-16).

## Contexte à lire (fichiers précis)

- `docs/adr/0068-owner-password-reset-and-second-factor-qr.md` (§ 4 et § 5), ADR 0076 § 3, ADR 0046 § 2.
- `apps/api/src/password-reset.ts` (parcours Telegram), `apps/api/src/invitation-links.ts` (liens `reset` du propriétaire).
- `apps/web/src/auth/ForgottenPasswordPage.tsx`.

## À faire (liste vérifiable)

- [x] Vérifier qu'un lien de réinitialisation créé par le propriétaire pour un membre ou une créatrice ne contredit pas l'ADR 0068 : il y est cité (contexte, EQ-10) et existe déjà.
- [x] Vérifier la route du propriétaire : elle existe déjà (`POST /v1/team/members/:memberId/invitation-link` et `POST /v1/creators/:creatorId/invitation-link`, `purpose: 'reset'`), propriétaire seul, connexion récente, journal d'audit sans le jeton. Aucune nouvelle route ni table.
- [x] La page « Mot de passe oublié » dit à qui n'a pas de Telegram de demander un nouveau lien à son agence.
- [x] Test d'intégration du chemin complet pour une créatrice et un chatteur.

## Critères d'acceptation (tests, commandes, comportements observables)

- `ForgottenPasswordPage.test.tsx` : la phrase « Pas de Telegram lié ? Demande un nouveau lien à ton agence. » s'affiche avant et après la demande, la même pour toute adresse.
- `invitation-links.integration.test.ts` : la créatrice et le chatteur sont refusés (403), le propriétaire sans connexion récente aussi ; le lien de la créatrice sert une fois, ferme ses sessions, refuse l'ancien mot de passe ; le lien d'un membre parti n'ouvre rien.
- `pnpm check`, `pnpm test` et la CI (intégration) verts.

## Hors périmètre

- L'écran côté propriétaire : les boutons existent déjà (fiche du membre, accès de la créatrice) ; leur présentation pour ce cas est pour le fil Design.
- La phrase du serveur (« Sinon, demande à un autre propriétaire. ») reste celle de l'ADR 0068 § 4.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Le lien du propriétaire vaut 72 h et remet le code à zéro (EQ-10, ADR 0046 § 2) ; celui de Telegram vaut 15 min et garde le code (ADR 0068 § 3). Deux parcours décidés, gardés tels quels.
- Un compte parti ou archivé reste refusé sans rien révéler : le parcours Telegram n'a pas changé.

## Résultat

La page « Mot de passe oublié » renvoie qui n'a pas de Telegram vers son agence, dont le propriétaire crée déjà le lien depuis la fiche du membre ou de la créatrice.
