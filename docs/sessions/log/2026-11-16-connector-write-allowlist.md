# 2026-11-16 — Garde d'écriture : n'ouvrir les envois qu'à une conversation

- **Tâche** : vente réelle sur le fan test (priorité de Charles, 16/11), partie connecteurs.
- **Fait** : `ConnectorConfig.writesOnlyTo` (ids de conversation de la plateforme, `null` par défaut = toutes). Avec `writes` ouvert et une liste, toute écriture vers une autre conversation (texte, média, étape de script, note, marque de lecture, saisie) est refusée par `connector_writes_not_allowed` avant que le connecteur soit construit. Route réservée au propriétaire `GET`/`PUT /v1/connector/accounts/:platformAccountId/write-guard` (connexion récente pour changer) : lue et changée sous la RLS de sa créatrice, le reste du rythme du compte gardé, une ligne `audit_log` `connector.write_guard` avec le nombre de conversations, jamais leurs ids.
- **Tests** : `outbound-sender.test.ts` (refus contre FakeReveal, conversation permise qui passe), `write-guard.integration.test.ts` (lecture, ouverture à une conversation, audit sans id, 403 opérateur, 404, 400).
- **Découvertes** : l'écran qui pose la garde reste à faire (Design ou Extension : le panneau du copilote connaît déjà l'id de la conversation ouverte).
- **Reste** : l'écran ; l'ouverture réelle sur le compte attend le mot écrit de Charles.
