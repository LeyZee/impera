# 2026-11-07 — La route de liaison d'un chatteur un à un retirée

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : candidat à suppression du journal d'Extension (#648), confirmé par Extension et le coordinateur

## Fait

- Retrait de `PUT /v1/settings/sales-feeds/:platform/chatters/:platformChatterId` et de `SalesFeeds.linkChatter` : depuis l'écran Équipe › Reveal (#648), tout lien passe par `POST …/team/links`, qui applique les mêmes gardes (ADR 0076 § 4) avec la liste en direct. Aucun appelant web ni extension.
- Le test de cette route dans `sales-feed.integration.test.ts` part avec elle ; les mêmes cas (lien à l'agent, membre inconnu refusé) restent couverts par `sales-feed-team.integration.test.ts`.
- `DailyStatsDay.platform` passe de `string` à `Platform` (remarque du fil Dashboard sur #647).

## Reste

- Rien.

## Découvertes

- Aucune.
