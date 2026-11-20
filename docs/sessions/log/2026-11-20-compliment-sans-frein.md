# 2026-11-20 — Un compliment se reçoit, jamais freiné — done
Fait : retour de Charles du 20/11 au Playground. Sur « tu es trop belle », le brouillon répondait « tu y vas un peu fort, non ». Le message était bien lu comme un flirt, mais la consigne du cerveau (« une petite réserve joueuse », « sans poser de question tout de suite ») poussait la voix au recul. Ce qui change : nouvelle garde bloquante `unwarranted_brake`, lue chaque fois que le curseur ne le ralentit pas, qui refuse « tu y vas fort », « doucement », « tu t'emballes » et « pas si vite », puis fait réécrire. La consigne de flirt dit maintenant qu'elle assume le compliment, le remercie et ne le freine jamais. Le cerveau passe en 1.20.0 : il ne dit plus jamais de se priver d'une question ouverte qui rebondit.
Pas fait : rien.
Décisions : aucune ADR touchée.
Découvertes : aucune.
Candidats à suppression : aucun.
Ajouté ensuite : NO_OPENING_HINT laisse le flirt permis (piste de Bilan) ; éval fictive compliment-insistent-first-message (accueil sans frein, puis une question).
Vérifié : tests du module agent, des évals et de llm, pnpm check.
