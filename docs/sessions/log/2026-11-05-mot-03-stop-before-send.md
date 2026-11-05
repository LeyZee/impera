# 2026-11-05 · MOT-03 : un Arrêt posé entre l'approbation et l'envoi ne laisse plus le fan sans réponse

- Fiche : recette du 05/11, MOT-03 (`api:conversations`).
- Fait : quand le job `send` expire un brouillon à cause d'un interrupteur ou d'une session expirée et que le dernier message du fan n'a reçu aucune réponse, `draft_expired` porte `leavesFanWaiting: true`. La projection lit alors la commande `expire_unanswered`, et la conversation repasse en `pending` au lieu de `idle`. La reprise (Copilote après l'Arrêt, réouverture des heures) la relance comme tout fan qui a écrit pendant l'arrêt. Une relance (P3-10) ou un envoi déjà commencé laissent la conversation au repos.
- Tests : machine à états, projection, `fanAwaitsAnswer`, et le test d'intégration « sends nothing once a kill switch is on… » attend désormais `pending`.
- Découvertes : la levée de l'interrupteur global et le retour d'une session expirée ne relancent pas les conversations `pending` (seule la levée de l'interrupteur de la créatrice le fait, `commands.ts` ≈ l. 502). Ces fans attendent le message suivant.
