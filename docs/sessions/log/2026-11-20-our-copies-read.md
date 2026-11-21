# 2026-11-20 — SCB-04 Lecture « nos copies reconnues » pour l'agent (ADR 0161 § 5) — done

Fait : chaque script natif lu par le module scripts porte `ours` : le script préparé dont il est la copie reconnue, avec notre description, notre moment et, étape par étape, le prix et la devise de chaque branche ; `null` pour un script natif qu’aucun de nos scripts n’a pris. L’agent le lit par `forJobs.accountScripts`, sans nouvel accès par le rôle de service (même transaction).
Pas fait : le branchement dans `agentScriptViewOf` (fil Agent, petit lot après son lot 1).
Décisions : aucune nouvelle (ADR 0161).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : typecheck et lint de l'API ; test d'intégration écrit dans prepared-scripts.integration.test.ts (Docker absent ici, il tourne en CI).
