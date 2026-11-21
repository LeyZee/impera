# 2026-11-16 — Le cerveau lit le brief du repli, et dit pourquoi une sortie est refusée — done
Fait : `BriefFromModelSchema` (un champ facultatif `null` ou vide est retiré, une liste `null` devient vide, puis `BriefSchema` inchangé) ; `llm_calls.error_code` (migration 0216) : chemin et type de l'erreur de schéma, « json », « truncated » ou « no_output », jamais le contenu ; délai du cerveau de 30 à 45 s (réglage réversible, la deuxième demande part toujours à 22 s) ; tests de la passerelle et du journal ; docs (moteur IA, modèle de données, opérations).
Pas fait : la vérification sur le PC après fusion (requête gratuite sur `llm_calls`, aucun appel Mistral payant).
Décisions : aucune ADR (lecture d'une sortie et réglage de délai, sans changement de règle) ; accord du coordinateur du 16/11 pour le délai.
Découvertes : relevé du PC du 16/11 (17h58-20h55 UTC, 167 appels du cerveau) : 104 bons, 37 délais dépassés (Grok à 30 s), 26 sorties refusées, toutes du repli Mistral ; les sorties de Grok comptent sa réflexion (médiane 845, jusqu'à 1 937 jetons) au-delà du plafond de 800, qui ne la borne pas.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests llm et db ✓, test d'intégration du journal ✓.
