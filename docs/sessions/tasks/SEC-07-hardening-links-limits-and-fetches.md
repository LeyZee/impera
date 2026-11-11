# SEC-07 Durcissement : liens d'extension, limites par adresse, appels sortants
Statut : done
Phase : exploitation
Dépend de : SEC-06
Branche : claude/project-thread-bfbfaz (fil « Corriger les failles de l'audit sécurité »)

## Objectif (1 phrase)

Appliquer, sans changer le métier, les points de l'audit de sécurité du 11/11/2026 qui touchent les liens d'extension, les limites par adresse et deux appels du module des connecteurs.

## Contexte à lire (fichiers précis)

- `docs/conventions/security.md` §6, `packages/db/src/sign-ins.ts`, `apps/api/src/modules/trends/infra/db/link-store.ts`.
- Le rapport d'audit est gardé hors du dépôt (dépôt public), comme celui du 02/11.

## À faire (liste vérifiable)

- [x] Une limite par adresse compte une adresse IPv6 par son préfixe `/64`.
- [x] Fermer les sessions d'un compte, son nouveau mot de passe et la remise à zéro de son code ferment aussi ses liens d'extension.
- [x] Un lien d'extension qui n'a pas servi depuis 30 jours ne vaut plus rien.
- [x] La photo d'une créatrice est récupérée à l'adresse qui a été vérifiée.
- [x] Une livraison refusée du flux des ventes écrit en base une fois par minute au plus.
- [x] Un scénario d'évaluation « recette de cuisine » dans `evals/adversarial/`.

## Critères d'acceptation (tests, commandes, comportements observables)

- `security.test.ts` (contrats) : `limitKeyOf` ; `server.test.ts` : deux adresses d'un même `/64` partagent un compteur.
- `trends.integration.test.ts` : un lien fermé avec les sessions ou resté 30 jours sans servir est refusé.
- `fetch-avatar.test.ts` : la requête part vers l'adresse vérifiée, quel que soit ce que le nom rend ensuite.
- `pnpm check`, `pnpm test`, `pnpm test:integration` et la CI verts.

## Hors périmètre

- Reconfirmation à la création d'un lien d'extension par le propriétaire : change un écran, lot suivant avec captures.
- Bornes du message entrant et plafond par conversation : attendent le choix de Charles.
- Rôle de base intermédiaire : ADR à proposer à Charles.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- `revokeExtensionLinks` vit dans `packages/db` à côté de `revokeSignIns` : la table est réservée au rôle admin, et les appelants (auth, équipe, ops) ne peuvent pas importer le module `trends`.
- La durée sans usage se lit en SQL au moment de la requête (`coalesce(last_used_at, created_at)`), sans tâche de purge ni migration.
- Le scénario d'évaluation ne tourne qu'avec `pnpm evals` (clé xAI) ; il n'a pas été joué ici.

## Résultat

Limites par adresse justes en IPv6, liens d'extension fermés avec les sessions et périmés après 30 jours sans usage, photo récupérée à l'adresse vérifiée, écriture bornée sur les refus du flux des ventes.
