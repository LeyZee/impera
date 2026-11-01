# 2026-10-25 — Reprise après un Arrêt : les réponses dues partent l'une après l'autre — done
Fait : à la reprise (Copilote ou Automatique depuis Arrêt dans `setAgentMode`, interrupteur levé par `ops.ts`), les `conversation.respond` des fans qui ont écrit pendant l'arrêt ne partent plus toutes à la même seconde : `resumeRunAt` (contracts) place la plus ancienne attente tout de suite, puis une toutes les 15 s (`RESUME_SPACING_SECONDS`). `idsInState` et la lecture d'`ops.ts` trient par `last_inbound_at`, le fan qui attend depuis le plus longtemps en tête. `message-flow.md` § 6 le dit.
Pas fait : rien.
Décisions : 15 s d'écart (choix par défaut) : sous le debounce de 45 s, et cent fans en attente sont tous servis en 25 minutes.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ ; intégration `agent-mode.integration.test.ts` (deux fans en attente : le premier tout de suite, le second 15 s plus tard ; R-G2 inchangé).
