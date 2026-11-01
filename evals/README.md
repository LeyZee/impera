# evals/

Évaluations du moteur IA (ADR 0009, `docs/conventions/testing.md`, playbook `write-an-eval.md`). Chaque scénario passe par le même chemin qu'un vrai message (cerveau, politique, voix, gardes dures), puis le juge note la réponse. Rien n'est envoyé ; la persona est la persona de démo, fictive (ADR 0010).

```
scenarios/      comportement attendu : KYC, mémoire, relance, médias, langue, curseur de sexualisation, offre, délai, refus de prix, pack refusé, manque d'argent, ventes gelées
adversarial/    le fan attaque : injection (directe, jeu de rôle, en plusieurs messages), « t'es un bot ? », rencontre, contact ou paiement hors plateforme, promesse d'amour, mineur, détresse, harcèlement, produit dangereux, abus réel
regression/     bugs réels rejoués (nommés par fiche de tâche)
thresholds.json seuils par critère pour `smoke` (nuit) et `full`
run.ts          garde : refuse une suite trop courte ou sans clé, puis lance l'exécuteur
probe/          test express d'un modèle (`pnpm probe`)
```

L'exécuteur vit dans `apps/api/src/scripts/evals.ts` (il appelle le code de l'agent) ; le format d'un scénario est `apps/api/src/scripts/evals/scenario.ts`, les vérifications `apps/api/src/scripts/evals/check.ts`. Les rubriques du juge sont dans `packages/llm/prompts/judge/`.

Commandes : `pnpm evals` (smoke : tout sauf `tier: full`), `pnpm evals -- --full`, `pnpm evals -- --file evals/adversarial/asks-if-bot.yaml` (chemin depuis la racine).

Juge : il note mieux ce qu'un autre modèle a écrit. L'exécuteur prend Mistral, sinon Gemini, dès que leur clé existe ; avec la seule clé xAI, le juge est Grok comme la voix et le rapport le dit : ces notes-là sont à lire avec ce biais d'auto-évaluation, et ne suffisent pas à ouvrir l'Automatique (ADR 0019 exige aussi le test à l'aveugle).

Coût : chaque passage a son propre plafond de 3 € (`EVALS_CAP_EUR`), à part des 20 €/jour de l'agent ; au plafond, la suite s'arrête et échoue.

Règles : données fictives uniquement ; résultats collés dans la PR ; on n'abaisse jamais un seuil pour passer la CI ; `smoke` ≤ 30 scénarios.
