# 2026-11-21 — Place du juge des évaluations — done

Fait : le juge des évaluations (Mistral Large 4) réfléchit avant de répondre, et sa réflexion compte dans sa limite de sortie : 3 600 à 4 600 jetons sur une courte conversation (relevé du PC, 21/11). Avec 2 000, il n'écrivait jamais ses notes (« le juge n'a pas répondu » sur les 13 scénarios joués). Sa place passe à 8 000 jetons et son délai à 180 s, dans les évaluations seulement ; les rôles de production ne changent pas.
Aussi : la sonde (`pnpm probe`) garde le réglage de réflexion de chaque rôle ; sans lui, Grok réfléchissait au niveau par défaut de xAI et le cerveau dépassait son délai sur 13 messages sur 14 (CI du 21/11). La concurrence de la CI sépare les événements : une fusion sur main n'annule plus un lancement manuel ou nocturne.
Reste : baisser sa réflexion à « low » n'est pas possible par notre SDK (`@ai-sdk/mistral` n'accepte que `high` ou `none`, et Mistral refuse `none`) ; à revoir si le coût du juge pèse.
Découvertes : aucune.
