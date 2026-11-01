# 2026-10-27 — Raison de passation sans code machine — done
Fait :
- `handoff_requested` prend `detail` (codes du moteur, au plus 20), en ajout. `reason` reste une phrase pour un chatteur et le moteur ne l'écrit plus : `respond` et `follow-up` mettent `[motif, …détail]` dans `detail`.
- Relecture des lignes anciennes (`rows.ts`, ADR 0007) : une `reason` qui commence par un motif du moteur (`guard_blocked`, `handoff`, `budget_reached`, `llm_unavailable`, `waited_no_reply`) passe dans `detail`, le journal n'est pas réécrit. Une phrase écrite par un humain reste `reason`.
- Le lecteur du Suivi n'affiche plus « llm_unavailable : no voice key » : il dit la cause en mots (`CAUSE_LABELS`).
Pas fait : rien.
- Relectures : JSDoc d'`upcast` remis au-dessus de sa fonction ; codes vides filtrés (une ancienne raison coupée à 500 après « : » aurait fait échouer la lecture du journal) ; `waited_no_reply` garde une raison en phrase (« après l'attente, l'agent n'avait plus rien à lui écrire »), situation connue et non cause technique.
Décisions : la règle vient de la recette locale d'Extension (relayée par le coordinateur) : une raison de passation est une phrase en français ; une cause technique laisse la raison vide et met le code dans les détails.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; intégration conversations, composer, relances, réponse différée, Telegram.
