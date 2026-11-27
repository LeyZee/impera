# 2026-11-26 — La langue du fan, appelants de `composeTurn` — done
Fait : l'exécuteur d'évaluations (`apps/api/src/scripts/evals.ts`) et le playground (session, moteur, `apps/api/src/scripts/playground.ts`, `apps/api/src/scripts/fan-sim.ts`) donnent à `composeTurn` les langues parlées et les exemples par langue de la persona, lus par la même fonction que le chemin réel (`languagesOf`, dans `agent/infra/persona-file.ts`, désormais aussi utilisée par `composerFields`). Sans elles, le composeur retombait sur le français seul : les scénarios L1 à L3 échouaient à tort et le playground répondait en français à un fan anglophone. `spokenLanguages` et `languageExamples` sont obligatoires dans `ComposerPersona` et `PersonaForModels`, `languages` dans `PlaygroundDeps` : un appelant qui les oublie ne compile plus. `FRENCH_ONLY` est exporté pour les tests qui veulent le français seul ; test du playground qui répond dans la langue du fan avec ses exemples.
Pas fait : rien sur la fiche.
Décisions : `languagesOf` plutôt qu'une copie des deux lignes de `composerFields` ; les tests disent le français seul explicitement (`FRENCH_ONLY`) au lieu d'un repli silencieux.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test. `pnpm evals` non lancé (payant).
