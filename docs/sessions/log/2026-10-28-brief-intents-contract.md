# 2026-10-28 — Intentions du Brief dans le contrat — done
Fait : `BRIEF_INTENTS` (liste fermée, `as const`), `BriefIntentSchema` et `BriefIntent` dans `packages/contracts/src/brief.ts` ; `packages/llm` lit `intent` par ce schéma au lieu d'une liste en dur. Même liste, même ordre : rien ne change pour le cerveau. Test de contrat (pas de doublon, `other` en dernier). Demande d'Extension, pour typer les intentions côté web sans dépendre de `@nirvana/llm`.
Pas fait : `PlaygroundAnswer.brief.intent` reste `z.string()` : le typer casse `apps/web/src/screens/train/playground` (démo et tests), à faire par Extension dans sa PR en même temps que l'écran.
Découvertes : aucune.
Candidats à suppression : aucun.
