# 2026-11-07 — Recette AGT-05, « À traiter » lisible pendant une panne de l'IA — done
Fait : « À traiter » (Suivi et Dashboard) est trié par l'écran, quel que soit l'ordre de la route : les lignes graves d'abord, puis ce qu'une personne peut faire (brouillon à valider, mot surveillé…), puis les pannes de l'agent ; le plus long à attendre d'abord dans chaque groupe. Une même panne (IA indisponible, plafond IA atteint, persona absente pour une créatrice) ne fait plus qu'une ligne « IA indisponible · 20 fans », avec l'attente la plus longue, qui ouvre la conversation la plus récente.
Pas fait : rien.
Décisions : la route `/v1/dashboard/todos` ne change pas (Bilan, 06/11) ; une panne qui ne touche qu'un fan reste une ligne à son nom.
Découvertes : `weightOf` (creators/scripts/model.ts) garde un plancher d'1 Mo, à corriger au prochain passage.
Candidats à suppression : aucun.
Vérifié : tests web (queue, Suivi, Dashboard), tsc et eslint sur les fichiers changés, captures Suivi et Dashboard Nuit et Jour, ordinateur et téléphone.
