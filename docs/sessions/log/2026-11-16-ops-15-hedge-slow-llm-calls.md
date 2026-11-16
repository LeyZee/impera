# 2026-11-16 — OPS-15 Un appel d'IA lent n'est plus attendu deux minutes — review
Fait : deuxième demande en parallèle au modèle principal du cerveau et de la voix après 22 s, première bonne réponse gardée, l'autre journalisée avec son coût ; délai dépassé = repli direct ; tests de la passerelle ; perdante marquée `loser` dans `llm_calls.hedge` (migration 0217 provisoire, numéro fixé à la fusion) et écartée de la santé ; minuteur arrêté ; docs (moteur IA, modèle de données, glossaire).
Pas fait : la mesure sur le PC après fusion (requête gratuite sur `llm_calls`).
Décisions : aucune ADR (l'ADR 0009 fixe « repli par rôle, timeouts » sans fixer les relances) ; dépense supplémentaire accordée par Charles le 16/11 (« go »).
Découvertes : `llm_calls` du PC (7 jours, 34 appels, lus par Bilan le 16/11) : cerveau médiane 18,7 s, p90 21,1 s, réponses jamais au-delà de 25 s, un délai dépassé sur 14 appels depuis OPS-06 ; voix médiane 9,1 s ; aucun repli ; d’où 22 s plutôt que 18 s, qui aurait doublé plus de la moitié des appels du cerveau ; le temps est la réflexion de Grok, pas le réseau.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓.
