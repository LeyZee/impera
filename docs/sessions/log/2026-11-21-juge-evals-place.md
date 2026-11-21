# 2026-11-21 — Place du juge des évaluations — done

Fait : le juge des évaluations (Mistral Large 4) réfléchit avant de répondre, et sa réflexion compte dans sa limite de sortie : 3 600 à 4 600 jetons sur une courte conversation (relevé du PC, 21/11). Avec 2 000, il n'écrivait jamais ses notes (« le juge n'a pas répondu » sur les 13 scénarios joués). Sa place passe à 8 000 jetons et son délai à 180 s, dans les évaluations seulement ; les rôles de production ne changent pas.
Reste : baisser sa réflexion à « low » n'est pas possible par notre SDK (`@ai-sdk/mistral` n'accepte que `high` ou `none`, et Mistral refuse `none`) ; à revoir si le coût du juge pèse.
Découvertes : délais xAI fréquents sur la voix (30 s) pendant la passe 1, à suivre avec ses résultats.
