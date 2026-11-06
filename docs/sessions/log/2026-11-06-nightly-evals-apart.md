# 2026-11-06 — Nightly : l'éval séparée de l'e2e, sautée sans clé

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point 4 de la suite de l'audit ; décision de Charles « nightly vert » (06/11)

## Fait

- `.github/workflows/ci.yml` : le job `nightly` ne fait plus que l'e2e. Un job `nightly-evals` à part lance `pnpm probe` puis `pnpm evals`.
  - Sans le secret `LLM_XAI_API_KEY`, ses étapes sont sautées. Une étape l'écrit dans le résumé du run (« Évaluations sautées, clé absente ») avec un avertissement, et la nuit reste verte.
  - Avec la clé, rien ne change : une évaluation qui échoue rend la nuit rouge.
- `scripts/check-repo.mjs`, règle 7 :
  - elle lit le job `nightly-evals` ;
  - elle exige que `HAS_XAI_KEY` soit lu une seule fois, du secret, au niveau du job ;
  - elle refuse toute autre condition que celle de la clé (ou celle du planning sur le job) ;
  - elle exige que les étapes `pnpm probe` et `pnpm evals` ne portent que `== 'true'` : la condition inverse est réservée à l'étape qui annonce le saut (relecture d'Agent) ;
  - elle refuse toujours qu'on retire `pnpm probe` ou `pnpm evals`, ou qu'on y mette `continue-on-error`.
  - Vérifié à la main : `HAS_XAI_KEY: false`, `if: false`, `!= 'true'` sur `pnpm evals` et un `HAS_XAI_KEY` redéfini sur une étape donnent chacun une erreur.
- Docs : `write-an-eval.md` § 6 et `testing.md` disent la nouvelle garde.

## Reste

- Rien. Le premier run planifié montrera le résumé.

## Découvertes

- Aucune.
