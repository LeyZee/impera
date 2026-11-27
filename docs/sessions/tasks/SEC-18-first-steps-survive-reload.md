# SEC-18 La première connexion survit à un rechargement
Statut : review
Phase : exploitation
Dépend de : ADR 0046 (avenant du 27/11/2026), SEC-02
Branche : claude/project-thread-bfbfaz (branche imposée par la session)

## Objectif
Un nouveau membre qui recharge la page pendant l'activation de la validation en deux étapes garde la même clé, retrouve l'étape où il était, ses codes de secours et son accueil.

## Contexte à lire
Recette du 27/11, parcours de première connexion (hors dépôt) ; `docs/adr/0046-dashboard-access-second-factor.md` et son avenant ; `apps/api/src/auth.ts` (routes du deuxième facteur) ; `apps/web/src/auth/SecondFactorPage.tsx`.

## À faire
- [x] Serveur : `POST /v1/auth/two-factor/enable` rend l'activation en attente telle quelle ; mot de passe facultatif sur une session ouverte depuis moins de 10 minutes, redemandé ensuite (`password_missing_forbidden`).
- [x] Deux marqueurs sur le compte (migration 0287) et `firstSteps` dans `GET /v1/session`.
- [x] `POST /v1/me/first-steps/codes-kept`, `/welcomed`, `/backup-codes` (codes réaffichés 10 minutes au plus, tant qu'ils ne sont pas dits notés, audité).
- [x] Écran : reprise à la clé après un rechargement, première étape sans mot de passe, textes de l'étape de la clé, bouton « Ouvrir dans l'application » au téléphone seulement.
- [x] App : codes réaffichés puis accueil, d'après le serveur et non plus un état en mémoire.

## Critères d'acceptation
- Intégration : même clé et mêmes codes à chaque demande jusqu'au premier code ; mot de passe exigé après 10 minutes ; marqueurs posés une fois ; codes refusés une fois dits notés ou la confirmation trop ancienne.
- Écran : reprise à la clé, champ du mot de passe seulement quand le serveur le demande, accueil et codes d'après `firstSteps`.

## Hors périmètre
`FirstWelcome.tsx` (fil Navigation) ; l'expiration d'une activation en attente restée sans code ; les captures (Design).

## Notes de session
- La ligne `two_factor` en attente est celle du plugin (`verified = false`), écrite comme lui, pour que son `verify-totp` la confirme.
- Un mauvais mot de passe sur l'activation compte maintenant dans les refus du compte (alerte au cinquième).

## Résultat
Code, tests et docs faits. Restent : les captures validées par Design ; idx du journal à recaler si une autre migration fusionne avant.
