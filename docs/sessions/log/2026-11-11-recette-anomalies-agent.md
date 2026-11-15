# 2026-11-11 · Anomalies de la recette, part Agent

Fait : `fan-insights.ts` (CR-15) ne compte les messages (« t'ont écrit cette semaine », activité, fans actifs) que des fans vus avant minuit, comme « en tout » (§ 2) ; un fan importé aujourd'hui avec l'historique de la semaine attend demain partout. Suivi (recette chatteur n°6) : la liste est triée sur le dernier message, comme l'heure affichée sous chaque pseudo, et plus sur la dernière modification de la conversation.
Vérifié : `fan-insights.integration.test.ts` (sept fans vus aujourd'hui ayant écrit hier) rouge avant la correction (20 contre 10), vert après, sur un Postgres 16 local par `IMPERA_TEST_PG_URL` ; `view.test.ts` (ordre du Suivi) ; tests du Suivi.
Reste : n°10 (« Limites du fan : Aucune ») laissé au fil de recette chatteur, texte d'écran à capturer.
Découvertes : aucune.
