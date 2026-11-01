# Ajouter ou changer un fournisseur LLM

Référence : `docs/architecture/ai-engine.md`, ADR 0009.

1. **Politique d'usage.** Lis la politique d'usage du fournisseur à la date du jour et note dans la PR ce qu'elle dit sur : contenu adulte, transparence IA, données (entraînement sur les entrées ? rétention ?), résidence des données. Si elle interdit l'usage prévu, note-le dans `ai-engine.md` et n'utilise ce fournisseur que pour les rôles compatibles (ex. Gemini : `sense` seulement).
2. **Adaptateur.** `packages/llm/src/providers/<provider>.ts` : fabrique sur le SDK Vercel (`@ai-sdk/<x>` ou `@ai-sdk/openai-compatible` avec `baseURL`). Supporte `generateObject` (sortie structurée) ; si le fournisseur ne supporte pas le mode JSON natif, utilise le mode `tool` ou `json` du SDK et teste la robustesse.
3. **Tarifs.** Ajoute les prix par million de tokens (entrée, sortie, cache, média si différent) dans `packages/llm/src/catalog.ts` (champ `pricing` du modèle) avec la date et la source.
4. **Capacités.** `ProviderCapabilities` : images ? vidéo native ? audio ? taille max de contexte ? sorties structurées natives ?
5. **Config.** Le fournisseur devient disponible dans `LlmRoleConfig.provider` (enum Zod). Ne change pas les défauts dans la même PR.
6. **Évals.** Lance `pnpm evals -- --provider <x>` sur `scenarios/` et `adversarial/`. Copie le tableau de résultats dans la PR, à côté du fournisseur actuel (mêmes scénarios, même rubrique). Pas de résultats, pas de merge.
7. **Repli.** Déclare ce fournisseur comme `fallback` d'un rôle avant d'en faire le défaut ; observe une semaine dans Langfuse (refus, latence, coût).
8. **Changement de défaut** : PR séparée, qui ne contient que le changement de config et le lien vers les évals.
9. **Secrets** (ADR 0016) : en production, la clé se saisit dans Réglages › Modèles IA et se lit par la source de clés de la passerelle (`ApiKeySource`) ; hors production, `LLM_<PROVIDER>_API_KEY` dans l'environnement sert de repli. Jamais dans le dépôt, jamais loguée ; `.env.example` mis à jour, et une vérification de la clé ajoutée pour l'écran.
