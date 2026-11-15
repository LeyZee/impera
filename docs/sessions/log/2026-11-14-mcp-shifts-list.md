# 2026-11-14 — MCP lot a, le planning

Fiche : `PROPOSED-mcp-read` (lot a, PR 10). Branche : `claude/project-thread-b38vt4`.
Fait : `shifts_list` (`read:team`) par `scheduling.reads.shifts`, passé par le câblage au port `ShiftReader` ; entrée `McpShiftsInputSchema` (période de 42 jours au plus, refusée sinon en `arguments_invalid`), sortie `McpShiftsListSchema` stricte sans compte de plateforme ni montant. `tools/list` reçoit la personne et ne montre un outil `ownerOnly` qu'au propriétaire sur un accès d'agence (remarque de Sécurité sur #756), test du refus `owner_only` au manager. Tests unitaires et d'intégration.
Pas fait : `team_import_list` (suivant) ; outils d'argent sous la forme fermée de l'option A ; conversations après les lectures d'Agent ; ressources, garde-fou, écran.
Décisions : Charles, 14/11 : option A, aucun montant d'argent par membre ne sort du serveur MCP.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
