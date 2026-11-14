# 2026-11-14 — MCP lot a, qui est en shift maintenant

Fiche : `PROPOSED-mcp-read` (lot a, PR 8). Branche : `claude/project-thread-b38vt4`.
Fait : contrat `McpOnShiftNowSchema` (strict) ; outil `on_shift_now` (`read:team`) par `scheduling.reads.onShiftNow` (#750), passé par `wiring/mcp.ts` à un port du domaine (`ShiftReader`), lu comme la personne de l'accès (rôle de `resolveActor`) sur la créatrice de l'accès, sinon celles qu'elle lit ; tests unitaires (portée, champs fermés, ni compte ni taux) et d'intégration (accès d'agence, accès borné, autre créatrice refusée).
Pas fait : `shifts_list`, `shift_reports_list`, relevés et ventes (outils d'argent par membre retenus jusqu'à la décision de Charles, consigne de la coordination du 14/11), ressources et prompts, garde-fou d'exfiltration, interrupteur, écran.
Décisions : `memberName` sort nu, c'est le nom d'un membre de l'équipe (comme `notedByName`).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
