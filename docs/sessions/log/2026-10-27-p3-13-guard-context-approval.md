# 2026-10-27 — P3-13 gardes de voix : contexte à l'approbation

- **Fil** : Bilan (plomberie). Suite de #226 (Agent), accord du 27/10.
- **Fait** :
  - le port `BubbleGuard` de `conversations` prend un `GuardReadContext` (les vingt derniers messages, `fan` ou `creator`, du plus ancien au plus récent) et rend des `GuardCode` ;
  - `approveDraft` lit cet historique dans la transaction de l'approbation ;
  - la racine de composition adapte vers `AgentBubbleGuard` par `guardContextOf` (un brouillon ne porte jamais de média) ;
  - `DraftGuarded` est typé en `GuardCode[]`.
- **Tests** : `conversations.integration.test.ts` (la garde reçoit les bulles et l'historique), `conversations-http.integration.test.ts` (« je t'envoie une photo » refusé en 422 `media_not_sent`).
- **Découvertes** : aucune.
