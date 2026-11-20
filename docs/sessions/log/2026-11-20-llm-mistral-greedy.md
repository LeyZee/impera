# 2026-11-20 — Le juge des évals répond : top_p à 1 pour Mistral, place pour sa note — done
Fait : la passerelle envoie `topP: 1` à Mistral quand le rôle tourne à température 0. Mistral refuse sinon chaque appel (400 `invalid_request_greedy_sampling`, « top_p must be 1 when using greedy sampling »), constaté sur le juge des évals passé sur Mistral Large 4 (PC de Charles, 20/11). Les autres fournisseurs et les rôles à température non nulle ne reçoivent rien de plus. Dans les évals, le juge a 2 000 jetons pour répondre (`EVALS_JUDGE_MAX_OUTPUT_TOKENS`) au lieu des 600 du rôle de production : ses neuf critères justifiés étaient coupés, et une note coupée n'est pas lisible (Mistral « no output », Gemini « truncated », 4 appels sur 4 sur le PC).
Pas fait : rien.
Décisions : `topP: 1` plutôt qu'une température de 0,01 : le juge reste déterministe, et le correctif couvre tout rôle à 0 qui passerait un jour sur Mistral.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; test de la passerelle (juge sur Mistral à 0 : top_p 1 ; repli Mistral de la voix à 0,9 et xAI : rien) ; test de `evalsConfig` (2 000 jetons au juge seul).
