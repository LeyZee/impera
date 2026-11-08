# 2026-11-08 — Un test du post du canal attendait le mauvais signal — fait

**Session** : Extension et playground · **Branche** : `claude/extension-reveal-playground-45axcj`

Fait : `ChannelPostPage.test.tsx` attendait un texte fixe de la page (« Rien n'est publié ») avant de choisir un lien. Sous charge, les liens du canal n'étaient pas encore lus et la liste « Lien » restait grisée, elle ne s'ouvrait pas. Le test attend maintenant que la liste soit active (deux pre-push rouges sur main ce soir, vert seul).
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : le test seul, pnpm check, pnpm test (pre-push).
