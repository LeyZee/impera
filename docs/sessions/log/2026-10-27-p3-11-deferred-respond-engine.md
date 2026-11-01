# 2026-10-27 — P3-11 Réponse différée, part moteur et filet « À traiter » — done
Fait :
- `holdDecision(brief, waited)` : un `wait` rend `no_reply` une seule fois ; `waitRetryAt` donne 20 minutes, dans la borne 5–25 que `conversations` accepte.
- Composeur : `retryAt` sur ce `no_reply` ; avec `waited ≥ 1`, jamais de second `wait`, une phrase « tu es revenu ? » sur un brief fixé par le code, sans rien de payant, toutes les gardes. Un risque de passation reste une passation après l'attente.
- Supervision : `unanswered` dans « À traiter » quand son dernier message attend depuis plus de 30 minutes sans réponse ni brouillon, conversation au repos ou job de réponse qui aurait dû finir (`idle`, `pending`, `drafting`) ; rien tant qu’un arrêt d’urgence la stoppe ou que Reveal n’est pas lu (session expirée, pause) ; remarque de Bilan. Contrat `DashboardTodoSchema.kind` en ajout, libellé « Sans réponse » dans Dashboard et Suivi.
- Doc : fiche P3-11 (done, index), glossaire (À traiter).
Pas fait : rien.
Décisions :
- Le filet couvre aussi `pending` et `drafting` au-delà de 30 minutes : un job de réponse mort est le trou le plus probable, et la fiche demande un filet pour tout trou futur.
- Pas de ligne pendant un arrêt d'urgence : le Dashboard le dit déjà, et toutes les conversations en feraient partie.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; intégration `dashboard.integration.test.ts`.
