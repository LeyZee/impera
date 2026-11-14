# 2026-11-14 — MCP lot a, outils des dépôts et des scripts

Fiche : `PROPOSED-mcp-read` (lot a, PR 7). Branche : `claude/project-thread-b38vt4`.
Fait : contrats `McpDropsListSchema`, `McpScriptsListSchema`, `McpScriptStepsGetSchema` (stricts) et types `untrusted` `creator_sentence` et `script_text` ; outils `drops_list`, `scripts_list` (`read:media`) et `script_steps_get` (`read:script_content`) par `contentDrops.reads` et `scripts.reads` (#749), passés par `wiring/mcp.ts` à un port du domaine (`ContentReads`) ; le lecteur est la personne de l'accès lue pour l'appel (`userId`, rôle) ; le journal nomme un script lu par son `dropId` ; tests unitaires (rien d'un média, ni version ni prix, aucune chaîne libre hors d'un champ marqué) et d'intégration (liste des outils, pages vides, script absent, limite de page, journal) ; le journal du test de transport est lu dans l'ordre des appels.
Pas fait : autres outils de lecture, ressources et prompts, garde-fou d'exfiltration, interrupteur, écran, mode d'emploi.
Décisions : les clés des étapes et des ponts sortent en `untrusted` comme le reste des mots du script ; la bibliothèque des structures de l'agence n'est pas servie (avis de Médias, outil d'agence à décider plus tard).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, unitaires de l'API (232 fichiers), suite d'intégration complète (150 fichiers, Docker compris). Build des images impossible ici (dépôts Alpine injoignables).
