# SC-09 Séries proposées par l'IA
Statut : todo (idée acceptée par Charles le 03/11/2026, 13 h 38 ; attend la clé xAI)
Phase : scripts (ADR 0056)
Dépend de : SC-01 lot c2, clé xAI (`packages/llm`), persona active
Branche : task/sc-09-ai-series-ideas

## Objectif
Quand l'agence crée une étape, l'IA propose les séries A, B et C (tenue, décor, consigne), et l'agence les garde ou les corrige.

## À faire
- [ ] Un prompt versionné dans `packages/llm` et une sortie validée par Zod (trois séries au plus).
- [ ] Filtrage dans le code, jamais dans le prompt : chaque proposition passe `disgustBlocks` sur la persona de la créatrice visée (ou toutes les personas actives pour une structure non réservée) ; une proposition bloquée n'est pas montrée.
- [ ] Rien n'est enregistré sans un clic de l'agence ; le journal `llm_calls` garde l'appel, le budget IA du jour s'applique.
- [ ] Évaluation dans `evals/` : pas de remise, pas de rencontre, rien qui touche une limite.

## Critères d'acceptation
- Tests : une proposition qui touche un dégoût est écartée ; sans clé, le bouton ne s'affiche pas.

## Notes de session
