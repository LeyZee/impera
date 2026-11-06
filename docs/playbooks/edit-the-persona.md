# Modifier la persona

Référence : ADR 0010, ADR 0079, `docs/reference/persona-schema.md`.

**Qui** : Charles ou Messa. Une session Opus ne modifie la persona que si la fiche de tâche le demande explicitement, et jamais le contenu intime sans instruction.

1. La vraie persona n'est **pas dans ce dépôt** (seulement les placeholders `personas/messalina/v0.0.0.yaml` au format 1 et `v0.1.0.yaml` au format 2). Travaille sur la copie privée.
2. Copie `vX.Y.Z.yaml` en `vX.Y.(Z+1).yaml` (correction), `vX.(Y+1).0` (ajout de section), `v(X+1).0.0` (changement d'identité ou de limites). Ne modifie jamais une version déjà activée.
3. Édite, au format 2 (`meta.schema: 2`, ADR 0079) : `sheet` est la fiche de Desirali, 7 panneaux et 59 questions en texte libre (`identity`, `lifestyle`, `preferences`, `conversation`, `relationships`, `intimacy`, `boundaries`) ; `agent` porte les réglages que le code applique (`strategies`, `follow_ups`, `notifications`, `behavior`, `rules`). Les « Réponses typiques » s'écrivent une par ligne et passent les gardes dures. Une version au format 1 se lit encore ; la convertir passe par l'écran, qui dit ce qu'il a déplacé. Détail : `docs/reference/persona-schema.md`.
4. Valide : `pnpm persona:validate personas/messalina/vX.Y.Z.yaml`. Les erreurs Zod sont explicites.
5. Évalue : `pnpm evals -- --persona vX.Y.Z` et compare avec la version active. Regarde surtout : naturel, cohérence, répétition, respect des limites.
6. Charge et active : `pnpm persona:load <fichier> --activate` (ajoute `--creator <id>` s'il y a plusieurs créatrices ; sans `--activate`, la version est seulement chargée). Recharger le même fichier ne crée rien ; un numéro déjà chargé avec un autre contenu est refusé. L'activation est auditée et horodatée, et l'ancienne version active cesse de l'être. Le CRM enregistre aussi des versions, jamais actives : elles s'activent de la même façon.
7. Garde l'ancienne version (jamais supprimée) : les drafts passés la référencent.
8. Si une règle de la persona devrait être **garantie** (ex. un nouveau dégoût), elle va dans `agent.rules` (lu par `guards.ts`), pas seulement dans « Zones interdites », que seul le modèle lit. Si non : fiche de tâche pour l'ajouter.
