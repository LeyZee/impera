# 2026-11-08 — Panneau copilote, lot (a) API (ADR 0086)

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : lot (a) de l'ADR 0086 (« ok 0086 » de Charles, 08/11, 17 h 11), routes et migration 0143 attribuées par le coordinateur

## Fait

- Contrat `packages/contracts/src/copilot.ts` : état du brouillon pour une conversation de la plateforme (`unknown`, `off`, `none`, `writing`, `ready`), geste du chatteur (`placed` avec `edited`, `rejected` avec une raison de la liste du playground et une note), les deux interrupteurs.
- `GET /v1/copilot/conversations/:platformConversationId/draft` : session du CRM ; le propriétaire et un manager actif partout, un chatteur seulement en poste sur elle (403 « Tu n'es pas en poste sur cette créatrice. »), son ouverture au journal d'audit (`via: copilot`, une fois par 15 minutes) ; une conversation inconnue rend `unknown`.
- `POST /v1/copilot/drafts/:draftId/verdict` : liaison par personne (`x-extension-link`), jamais le cookie ; une fois par brouillon (le même geste renvoyé ne crée rien) ; `placed` marque `drafts.placed_by/placed_at` sans changer le statut ; `rejected` passe par la commande de rejet existante et écrit la note `live` dans la même transaction.
- La liaison de l'extension s'ouvre aux chatteurs actifs, pour ces écritures seulement : les portes de la veille leur répondent 403 `trend_watch_forbidden` (ADR 0060 § 2 inchangé).
- Interrupteurs `GET/PUT /v1/creators/:id/copilot` (propriétaire, audités), rangés dans `creators.settings.copilot` : fiche allumée, brouillons éteints par défaut.
- Migration 0143 : `calibration_ratings` gagne `source` et `draft_id` (unique), une note `live` ne garde ni message du fan ni moment ; `drafts` gagne `placed_by`, `placed_at`.

## Reste

- Rapprochement du message sortant avec le brouillon (validé, corrigé, expiré à 15 min) et sa note `live` : fil Agent, qui peut appeler `tx.drafts.rateLive`.
- Les interrupteurs à l'écran Créatrices › Agent, « Relier l'extension » pour un chatteur, et le panneau : fil Extension.
- La fiche `PROPOSED-copilot-api.md` reste à numéroter ; ce qu'elle disait des verdicts `validated`/`corrected` envoyés par l'extension est remplacé par l'ADR 0086 § 5.

## Découvertes

- `calibration_ratings` n'était écrite par aucun code : le playground garde ses notes en JSONL. Les notes `live` sont les premières lignes réelles.
- Une note `live` tient son brouillon par clé étrangère et la table est en ajout seul : une future purge des brouillons devra en tenir compte.
