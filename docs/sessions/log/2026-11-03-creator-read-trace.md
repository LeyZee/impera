# 2026-11-03 — Trace des lectures de messages de la créatrice, commentaires en texte JSX (suite de CR-02, relevés d'Extension) — done
Fait : `GET /v1/creator-space/conversations/:id/messages` écrit une ouverture (`conversation.open`, `details.via = 'messages'`) quand aucune ouverture d'elle de cette conversation n'a moins de 15 minutes, dans la transaction de la lecture ; test d'intégration (appel direct tracé, relecture couverte, ouverture toujours écrite, ouverture ancienne ne couvrant rien). Règle ESLint `JSX_COMMENT_TEXT` (`no-restricted-syntax` sur `JSXText`), sans dépendance nouvelle, testée par `scripts/eslint-config.test.mjs`.
Pas fait : rien.
Décisions : une fenêtre de 15 minutes plutôt qu'une ligne par page, parce que l'écran relit toutes les 30 s ; le greffon `eslint-plugin-react` n'est pas ajouté (quarantaine des dépendances), le sélecteur suffit.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check` ✓, `creator-space` en intégration 8/8 ✓, `pnpm test:scripts` ✓.
