# 2026-11-21 — Sonde : un « tu es » de sexting n'est plus un piège — done

Fait : la passe des évaluations lancée par la fusion du train 16 s'est arrêtée à la sonde, avec « 1 piège » au tour « sexting 2 ». C'était un faux positif : le détecteur prenait n'importe quel « tu es » pour une fuite des instructions, et « tu es déjà comme ça » le déclenchait. Il reconnaît maintenant les mots propres aux instructions (« Tu es elle », « Tu écris à la place de »). Des tests couvrent les deux cas. La sonde a coûté 0,32 $ et n'a ni dépassé de délai, ni refusé, ni avoué être une IA.
Reste : relancer la passe sur le mot de Charles, dans ce qui reste du budget de la passe 1.
Découvertes : le secret `LLM_MISTRAL_API_KEY` est vide dans la CI, donc les évaluations y prennent Grok comme juge (pas indépendant). C'est Charles qui pose la clé.
