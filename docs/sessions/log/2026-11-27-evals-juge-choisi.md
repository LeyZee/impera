# 2026-11-27 — Évals : le juge se choisit (`--judge`) — done
Fait : `pnpm evals --judge google|mistral` impose le juge et s'arrête si sa clé manque ; le rapport signale un juge de la même famille que la voix ou que son secours. Sans l'option, rien ne change (premier fournisseur autre que celui de la voix).
Pas fait : rien.
Décisions : Charles a choisi le 27/11 une mesure complète du naturel sur la voix de secours (Mistral) avec Gemini comme juge, avant le 1er, pendant que le quota xAI est épuisé.
Découvertes : `pnpm evals` lit encore la fiche de démo 0.6.0 par défaut, alors que fan-sim passe en 0.7.0 (#1086).
Candidats à suppression : rien.
Vérifié : test de `judge-model` (7 cas), typecheck et lint de l'API, prettier.
