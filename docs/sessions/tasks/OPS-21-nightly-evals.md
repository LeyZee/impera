# OPS-21 Les évaluations de l'IA chaque nuit, à budget plafonné
Statut : in_progress (demande de Charles du 20/11/2026, relecture « santé du code », point 2)
Phase : exploitation
Dépend de : OPS-11 (tirages), ADR 0009
Branche : task/ops-21-nightly-evals

## Objectif
Chaque changement de l'IA est mesuré la nuit suivante, sans payer les nuits où rien n'a bougé : aujourd'hui le job `nightly-evals` est sauté chaque nuit faute de clé.

## Contexte à lire
`.github/workflows/ci.yml` (job `nightly-evals`), `apps/api/src/scripts/evals.ts`, `apps/api/src/scripts/evals/judge-model.ts`, `evals/README.md`, `docs/playbooks/write-an-eval.md`, `scripts/check-repo.mjs` (garde 7).

## À faire
- [x] `pnpm evals -- --cap-eur <€>` : plafond d'un passage abaissé, jamais au-dessus de `EVALS_CAP_EUR` (6 €) ; la fin du passage écrit ce qui a été dépensé.
- [x] Étape « Plan de la nuit » : dimanche et lancement à la main, 3 tirages plafonnés à 4 € ; un autre jour, 1 tirage plafonné à 1,50 € si l'IA a changé en 26 h, sinon rien (dit dans le résumé du run).
- [x] Garde 7 de `check-repo` : le plan est la seule autre raison de sauter les évals, et la passe du dimanche reste.
- [ ] Charles crée une clé xAI et une clé Mistral propres à la CI (crédit prépayé sans recharge automatique si la console le permet) et les saisit lui-même dans GitHub › Settings › Secrets and variables › Actions (`LLM_XAI_API_KEY`, `LLM_MISTRAL_API_KEY`).
- [ ] Premier passage lancé à la main (« Run workflow ») après la pose des clés, résultat relu.

## Critères d'acceptation
- Aucune dépense une nuit où l'IA n'a pas changé, sauf le dimanche.
- Un passage s'arrête et échoue à son plafond ; au pire 56 € par mois.
- Persona de démo seulement : le journal de la CI est public.

## Hors périmètre
`--persona-from-crm` en CI (jamais : données réelles) ; le plafond de 20 €/jour de l'agent, qui ne compte pas ces passages.
