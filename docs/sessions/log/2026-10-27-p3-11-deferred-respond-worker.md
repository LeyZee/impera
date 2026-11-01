# 2026-10-27 — P3-11 Réponse différée, part worker — in_progress
Fait :
- Contrats en ajout : `conversation.respond` gagne `waitedFor?`, `reply_skipped` gagne `retryAt?`.
- Port : `ComposeInput.waited?`.
- Sur `no_reply` avec un `retryAt` entre 5 et 25 minutes (`deferredRespondAt`), `respond` écrit `reply_skipped` avec ce `retryAt` et remet `conversation.respond` en file à cette heure, sur la même clé (`replace`), avec `waitedFor` = son dernier message.
- Au second passage, le job accepte la conversation au repos tant que ce message est le dernier et sans réponse d'elle, et passe `waited: 1` au moteur. Un brouillon s'écrit avec la clé d'idempotence habituelle ; sinon, `handoff_requested` (cause `other`, raison `waited_no_reply`).
- Doc : `message-flow.md` §2, glossaire, fiche.
Pas fait :
- Le moteur (`holdDecision` → `retryAt`, « tu es revenu ? » avec `waited`) : fil Agent.
- Le filet de 30 minutes dans « À traiter » : supervision, zone Agent, à décider avec lui.
Décisions :
- Le second passage est porté par la charge du job (`waitedFor`), pas compté dans le journal : un nouveau message remplace le job et remet tout à zéro, sans requête de plus.
- Borne côté worker 5–25 minutes, pour que le filet de 30 minutes passe toujours après la reprise ; bornes accordées avec le fil Agent (10–25 côté moteur).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; intégration `deferred-respond.integration.test.ts` (6 tests), `follow-ups`, `conversations*`.
