# 2026-11-05 · CHAT-25 : un brouillon refusé laisse la conversation au chatteur

- Fiche : recette du 05/11, CHAT-25, reco 6 (Charles, « go recos »).
- Fait : un refus pendant que le fan attend sa réponse fait passer la conversation à `human` (la commande pose `leavesFanWaiting` sur `draft_rejected` d'après `fanAwaitsAnswer`, la projection en tire `reject_unanswered` : un journal écrit avant se rejoue tel qu'il a été décidé, relecture Bilan) au lieu de `idle`. Celui qui a refusé répond dans Reveal ; l'agent ne relance rien tout seul jusqu'à « Rendre la main ». Une relance refusée (le fan n'attend rien) reste au repos, comme avant.
- Tests : projection, intégration (transition interdite, reconstruction du journal, note de désir).
- Reste au fil Recette (CHAT-25 côté écran, lot 7) : le texte du lecteur après un refus.
