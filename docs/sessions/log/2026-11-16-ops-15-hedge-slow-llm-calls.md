# 2026-11-16 — OPS-15 Un appel d'IA lent n'est plus attendu deux minutes — review
Fait : deuxième demande en parallèle au modèle principal du cerveau et de la voix après 18 s, première bonne réponse gardée, l'autre journalisée avec son coût ; délai dépassé = repli direct ; tests de la passerelle ; docs (moteur IA, glossaire).
Pas fait : la mesure sur le PC après fusion (requête gratuite sur `llm_calls`).
Décisions : aucune ADR (l'ADR 0009 fixe « repli par rôle, timeouts » sans fixer les relances) ; dépense supplémentaire accordée par Charles le 16/11 (« go »).
Découvertes : mesures du 12/11 sur le PC : cerveau médiane 16,4 s, voix 11,5 s, tour médian 22 s, p90 38 s, un délai dépassé sur huit tours ; le temps est la réflexion de Grok, pas le réseau.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓.
