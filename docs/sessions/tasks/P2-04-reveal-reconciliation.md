# P2-04 Réconciliation Reveal : envois perdus, ventes, historique

Statut : todo
Phase : 2
Dépend de : P2-02
Branche : task/p2-04-reveal-reconciliation

## Objectif
Rien ne se perd entre Reveal et nous : un envoi resté sans réponse est retrouvé ou marqué en échec, chaque achat est relié à son message, et l'historique d'une conversation s'importe en entier une fois.

## Contexte à lire
`docs/architecture/message-flow.md` § 7 ; `connectors/application/reconcile.ts` ; ADR 0050 (ventes par l'API CRM) ; `docs/reference/reveal-connector-spec.md` §§ 4, 5.

## À faire
- Volet « envois non retrouvés → `send_failed` après 5 min » de `connector.reconcile` (reste de P0-06), avec `connector_sends`.
- Lien vente ↔ message : `transactionId` du bundle dans le fil ↔ transaction ↔ vente de l'API CRM, pour le nom du pack dans les alertes et l'entonnoir par bundle (ADR 0050, conséquences).
- Import initial de l'historique d'une conversation, page par page, sans doublon, au rythme du connecteur.

## Critères d'acceptation
- Tests d'intégration contre FakeReveal : envoi perdu → `send_failed` ; achat → vente reliée à son message ; import de 320 messages sans doublon, puis poll incrémental.

## Hors périmètre
Ventes et paie (ADR 0050, autre voie).

## Notes de session
