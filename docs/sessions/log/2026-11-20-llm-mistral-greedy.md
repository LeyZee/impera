# 2026-11-20 — Mistral à température 0 : top_p à 1 — done
Fait : la passerelle envoie `topP: 1` à Mistral quand le rôle tourne à température 0. Mistral refuse sinon chaque appel (400 `invalid_request_greedy_sampling`, « top_p must be 1 when using greedy sampling »), constaté sur le juge des évals passé sur Mistral Large 4 (PC de Charles, 20/11). Les autres fournisseurs et les rôles à température non nulle ne reçoivent rien de plus.
Pas fait : rien.
Décisions : `topP: 1` plutôt qu'une température de 0,01 : le juge reste déterministe, et le correctif couvre tout rôle à 0 qui passerait un jour sur Mistral.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; test de la passerelle (juge sur Mistral à 0 : top_p 1 ; repli Mistral de la voix à 0,9 et xAI : rien).
