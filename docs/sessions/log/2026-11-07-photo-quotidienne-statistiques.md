# 2026-11-07 — La photo quotidienne des statistiques de la plateforme (ADR 0081)

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur (ADR 0081 § 6, part de Bilan ; « ok 0081 » de Charles, 13 h 50)

## Fait

- Migration 0138 : `platform_daily_stats` (compteurs par compte et par jour de la plateforme, aucun montant, RLS forcée, lue par le propriétaire et le manager actif dont la liste contient la créatrice, jamais écrite par `nirvana_app`), `sales_feed_stats_calls` (appels aux statistiques comptés par jour, RLS sans politique, fermée à `nirvana_app`) et `sales_feed_cursors.stats_full_read_at`.
- Job horaire `connector.read_daily_stats` : 31 jours à 5 h dans le fuseau de la plateforme ou tant qu'aucune lecture de 31 jours n'a réussi depuis la vérification de la clé, sinon aujourd'hui et hier ; modèles reliées à une créatrice non archivée seules ; un 429 et une clé refusée suivent la règle de la lecture des ventes.
- Chaque appel aux statistiques (le job, et les deux du contrôle de fiabilité) est compté avant d'être fait ; le job n'appelle plus sous 100 appels restants sur 500.
- L'adaptateur Reveal garde `unsubscribes` et `renewals` (nuls quand Reveal ne les donne pas).
- Lecture exposée pour le fil du Dashboard : `dailyStatsOf(tx, { from, to })` et le type `DailyStatsDay`, par l'`index.ts` de `connectors`, dans le `withTenantMember` de la route.
- Tests : domaine (plage, heure de la plateforme, réserve, lignes gardées) et intégration contre FakeReveal (31 jours puis 2, appels comptés, contrôle compté, réserve, lecteurs, écriture refusée à l'application, créatrice archivée). Le catalogue des tables fermées (`rls-policies`) prend `sales_feed_stats_calls`.
- Corrigé au passage : le commentaire de `SalesFeedTeamLinked` dans `domain/errors.ts`, déplacé par erreur en #643 (signalé par Équipe).

## Reste

- Le fil du Dashboard : la route `GET /v1/dashboard/agency` et le bloc « Abonnés » (ADR 0081 § 4).

## Découvertes

- Aucune.
