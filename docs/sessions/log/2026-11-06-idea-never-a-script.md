# 2026-11-06 — Une idée ne demande jamais un script

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point relevé par Médias sur #603 (ADR 0056)

## Fait

- `packages/contracts/src/trends.ts` : `IdeaDropCategorySchema`, c'est-à-dire toutes les catégories de dépôt sauf `script`. `ContentIdeaDraftSchema.category` la prend, donc la correction (`ContentIdeaCorrectionSchema`) et la lecture d'une idée (`ContentIdeaSchema`) aussi. Une idée écrite par le modèle ou corrigée par l'agence ne peut plus être un script : un script se demande avec une structure de la bibliothèque et sa version figée.
- `trends` : l'idée suivie (`FollowedIdea`) porte ce type, et la lecture du store le vérifie. Le cas « idée script » de `followDecision` disparaît, puisqu'il ne peut plus arriver. Avant, une idée script validée devenait une suggestion qui ne demandait jamais rien : elle restait `suggested` pour toujours.
- Test du contrat : `script` est refusé dans une correction, une autre catégorie passe.
- Écran « Idées du jour » (#603, fusionnée avant) : `CORRECTABLE_CATEGORIES` reprend les catégories du contrat, à la place de `correctableCategories`. Celle-ci gardait « Script » affiché pour une idée qui le portait déjà, un cas que le contrat ne laisse plus arriver.

## Reste

- Rien.

## Découvertes

- `content_ideas` garde en base le CHECK de toutes les catégories (`DROP_CATEGORIES`). Le code n'y écrit plus de script. Le resserrer demanderait une migration, que je ne fais pas sans demande. Tant qu'il ne l'est pas, une ligne `script` qui existerait déjà ferait échouer la lecture des idées et le suivi (remarque de Médias). Aucune n'est possible aujourd'hui : rien n'est déployé.
