# Copilote sur Reveal : brouillons en attente et verdicts, côté API (ID à attribuer)
Statut : proposed (décision de Charles le 17/10 à 21h44, recommandation du coordinateur ; précisée par l'ADR 0086, acceptée le 08/11 : le chatteur envoie lui-même et ce qui part fait le verdict, § 4 et 5. Routes, migration 0146 et interrupteurs livrés par le fil Bilan, journal `2026-11-08-panneau-copilote-api.md` ; reste le rapprochement, fil Agent)
Phase : 3
Dépend de : P0-05, P0-06, P3-05, calibration_ratings (#46), lot A Reveal
Branche : task/<id>-copilot-api

## Objectif
Tant que le taux « sans retouche » réel n'a pas atteint 80 %, l'agent travaille en copilote. Le chatteur voit le brouillon dans l'extension, à côté de la conversation Reveal, et choisit Envoyer, Retoucher ou Refuser avec une raison. Chaque geste devient une note de calibrage, ce qui alimente le taux réel.

## Contexte à lire
`apps/api/src/modules/conversations` (commandes `approve` / `reject`, `drafts`, routes), `apps/api/src/modules/connectors/infra/http/routes.ts` (authentification de l'extension par jeton d'appareil), `packages/contracts/src/playground.ts` (verdicts, raisons de rejet, destinations), `packages/db/src/schema/calibration.ts`, ADR 0018, fiche UI du fil Extension.

## À faire
- [ ] Contrat partagé dans `packages/contracts` (`copilot.ts`), écrit avec le fil Extension :
  - un brouillon en attente : id, conversation, bulles, création, expiration ;
  - un verdict : `validated`, `corrected` avec les bulles finales, `rejected` avec une raison de la liste fermée existante.
- [ ] Routes réservées à l'extension, sous l'authentification d'appareil existante, jamais de clé LLM côté extension :
  - `GET /v1/copilot/conversations/:platformConversationId/draft` : le brouillon en attente pour la conversation affichée ;
  - `POST /v1/copilot/drafts/:draftId/verdict`, idempotent par `draftId`.
- [ ] Chaque verdict passe par les commandes existantes (`approve`, `edit`, `reject`), avec événement au journal, et écrit une ligne `calibration_ratings` dans la même transaction.
  - Une nouvelle migration ajoute `draft_id` (nullable, unique) et une `source` (`playground` ou `live`), parce que les colonnes de session du playground ne s'appliquent pas en réel.
  - Le taux réel lit `source = live`.
- [ ] Envoi, par défaut proposé :
  - l'extension colle le texte dans le champ de Reveal et le chatteur appuie lui-même sur Envoyer ;
  - l'API rapproche ensuite le message sortant ingéré du brouillon ;
  - la garde d'écriture reste fermée. Envoyer par le connecteur reste possible plus tard, sur un compte ouvert.
- [ ] Glossaire : « Copilote » si le terme n'y est pas, « Verdict ».

## Critères d'acceptation
- Tests d'intégration :
  - un verdict de chaque sorte produit l'état de brouillon attendu, un événement au journal et une note `live` ;
  - un second envoi du même verdict ne crée rien ;
  - un autre appareil, ou une autre créatrice, reçoit 403 ou 404 (RLS).
- Test contre `FakeReveal` du rapprochement entre le message sortant et le brouillon.
- `pnpm check`, `pnpm test:all` verts. Aucune vraie donnée de fan dans les tests.

## Hors périmètre
L'interface dans l'extension (fiche du fil Extension), le passage automatique en mode Automatique à 80 % (bouton du CRM), les vocaux.

## Notes de session
