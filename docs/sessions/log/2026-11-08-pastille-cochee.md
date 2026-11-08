# 2026-11-08 — Pastille cochée qui perd son fond sous le pointeur — done

**Session** : Extension et playground · **Branche** : `claude/extension-reveal-playground-45axcj`

Fait : `.nv-chip:hover` ne s'applique plus qu'à une pastille non cochée, et seulement là où un pointeur survole (`@media (hover: hover)`). Avant, la règle de survol était plus spécifique que `[aria-checked='true']` : une pastille cochée sous la souris perdait son fond plein, et au téléphone le survol restait après le toucher, si bien que le choix semblait ne pas avoir pris. Toutes les pastilles de choix du CRM et de l'extension sont concernées. Test `chip.test.ts` (échoue sans le correctif).
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (pre-push), captures Nuit/Jour PC/téléphone.
