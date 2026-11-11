# 2026-11-11 · CR-15 fans vus aujourd'hui (Agent)

Fait : `fan-insights.ts` ne compte les messages (« t'ont écrit cette semaine », activité, fans actifs) que des fans vus avant minuit, comme « en tout » (§ 2). Un fan importé aujourd'hui avec l'historique de la semaine attend demain partout.
Vérifié : `fan-insights.integration.test.ts` (sept fans vus aujourd'hui, ayant écrit hier) rouge avant la correction (20 contre 10), vert après ; Postgres 16 local par `IMPERA_TEST_PG_URL`.
Reste : rien.
Découvertes : aucune.
