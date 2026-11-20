# 2026-11-20 — SCB-04 ADR 0161 : seulement nos scripts, Impera vers Reveal — done
Fait : ADR 0161 acceptée par Charles (carte de décision, 17 h 44 heure de Paris). La carte « Ses scripts dans Reveal » quitte l'onglet Scripts avec son code, ses tests et ses styles ; un script préparé reconnu s'affiche « Dans Reveal » ; le lien du Playground mène à « Ses scripts ».
Pas fait : côté serveur (agent, routes d'identité, reconnaissance en double, ordre des descriptions), voir la fiche.
Décisions : ADR 0161 (amende 0099 §§ 1 et 5, 0098 § 6, 0112 §§ 20 et 23).
Découvertes : les routes de validation et de correction d'identité des scripts natifs restent au serveur, propriétaire seul, et doivent partir avec le lot d'Agent qui ferme `agentScriptViewOf` (ADR 0161 § 8).
Candidats à suppression : aucun.
Vérifié : tests web de Créatrices et du Playground ; pnpm check.
