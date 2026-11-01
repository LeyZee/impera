# 2026-10-27 — Évaluations : 34 scénarios et un exécuteur sur le vrai chemin de l'agent — done

Fait : `pnpm evals` mesure enfin quelque chose. 32 scénarios inventés s'ajoutent aux 2 existants (34 ; 30 en `smoke` chaque nuit, 4 en `tier: full`) : KYC, mémoire, relance, langue étrangère, curseur de sexualisation, âge inconnu, offre permise, délai entre offres, refus de prix, pack refusé (chouinage borné, jamais reproposé), manque d'argent avoué, ventes gelées ; côté adversarial « t'es une IA ? » (deux fois), injection directe, en jeu de rôle et en plusieurs messages, tâche hors sujet, rencontre, contact et paiement hors plateforme, promesse d'amour, mineur suspecté, détresse, harcèlement. L'exécuteur `apps/api/src/scripts/evals.ts` fait passer chaque scénario par `composeTurn`, `holdDecision`, `offerDecision` et les gardes dures, puis le nouveau rôle `judge` de `LlmGateway` note la réponse (lue comme donnée, `<candidate_reply>`) sur les neuf critères de `evals/thresholds.json`. Le format d'un scénario est strict (Zod, risques et intentions du cerveau) ; un test vérifie que chaque fichier se lit et que la suite atteint le seuil `full`. `offerSignals(brief)` sort de la politique pour que l'exécuteur et le composeur lisent les mêmes signaux.

Pas fait : aucun scénario n'a tourné contre un vrai modèle (pas de clé xAI ici) ; les médias (vision) ne sont pas encore dans les scénarios ; la batterie d'injection de `agent/domain/injection.ts` est une PR à part.

Décisions : exécuteur maison plutôt que Promptfoo, jamais installé : un scénario doit passer par le code de l'agent, pas par un prompt isolé (`docs/conventions/testing.md`). Le juge vit dans `packages/llm` (rôle déjà prévu dans `DEFAULT_LLM_CONFIG`) ; l'exécuteur le passe sur Mistral ou Gemini dès que leur clé existe (relecture de Bilan : un modèle note trop bien ses propres mots), et chaque passage a son propre plafond de 3 €.

Découvertes : `README.md` disait encore « 0 test d'intégration », corrigé. Deux scénarios existants écrivaient `prénom: Hugo` sans guillemets (lu comme un objet YAML), corrigé.

Candidats à suppression : `evals/rubrics/` (vide, les rubriques sont le prompt du juge).

Vérifié : `pnpm check`, `pnpm test`, `pnpm evals` sans clé (échoue, message clair) et avec une clé factice (30 scénarios en smoke, 34 en full, tous en échec « le cerveau n'a pas répondu », la suite refuse de passer).
