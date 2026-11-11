# 2026-11-11 — OPS-04 Plantage journalisé, repli d'écriture épinglé, prix relus — done
Fait : `crash.ts` (moniteur des erreurs non attrapées, API et worker) ; repli `mistral-large-4` épinglé (config, catalogue, vérification de la clé, juge des évals, bac à sable, comparaison du playground) ; prix de Grok 4.7 et de Mistral Large 4 relus chez les fournisseurs, palier long contexte de xAI compté.
Pas fait : prix de Gemini 3.8 Flash (page de Google illisible ce jour-là) ; suivi d'erreurs externe (à décider par Charles).
Décisions : aucune ADR ; le changement de modèle de repli n'a pas pu passer par les évals (aucune clé posée), il retire seulement l'alias mobile.
Découvertes : `mistral.verifier.ts` acceptait n'importe quel identifiant commençant par `mistral-large` ; le job d'évals de nuit passe déjà la clé Mistral au juge.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, hygiène ✓ ; tests d'intégration laissés à la CI (pas de Docker dans cette session).
