# Modifier la persona

Référence : ADR 0010, `docs/reference/persona-schema.md`.

**Qui** : Charles ou Messa. Une session Opus ne modifie la persona que si la fiche de tâche le demande explicitement, et jamais le contenu intime sans instruction.

1. La vraie persona n'est **pas dans ce dépôt** (seulement `personas/messalina/v0.0.0.yaml`, placeholders). Travaille sur la copie privée.
2. Copie `vX.Y.Z.yaml` en `vX.Y.(Z+1).yaml` (correction), `vX.(Y+1).0` (ajout de section), `v(X+1).0.0` (changement d'identité ou de limites). Ne modifie jamais une version déjà activée.
3. Édite. Les sections suivent la fiche créatrice d'OnlyChat : `details` (identité et physique, listes de valeurs), `additional_info` (texte libre, 6 000 caractères), `behavior` (style de langage, découpage, délai), `strategies` (KYC, sexualisation, lancement des scripts, négociation, suivi d'offre), `follow_ups` (relances et petits rappels), `notifications` (dont les mots-clés d'alerte), plus `limits` (ce qu'elle ne fait, ne montre, ne dit jamais ; dégoûts), et les blocs facultatifs de P5-01 qui remplacent peu à peu `additional_info` : `lifestyle`, `tastes`, `intimate`, `writing_style`, `sample_replies` (dix réponses types au plus, refusées si une garde dure les bloquerait). Détail : `docs/reference/persona-schema.md`.
4. Valide : `pnpm persona:validate personas/messalina/vX.Y.Z.yaml`. Les erreurs Zod sont explicites.
5. Évalue : `pnpm evals -- --persona vX.Y.Z` et compare avec la version active. Regarde surtout : naturel, cohérence, répétition, respect des limites.
6. Charge et active : `pnpm persona:load <fichier> --activate` (ajoute `--creator <id>` s'il y a plusieurs créatrices ; sans `--activate`, la version est seulement chargée). Recharger le même fichier ne crée rien ; un numéro déjà chargé avec un autre contenu est refusé. L'activation est auditée et horodatée, et l'ancienne version active cesse de l'être. Le CRM enregistre aussi des versions, jamais actives : elles s'activent de la même façon.
7. Garde l'ancienne version (jamais supprimée) : les drafts passés la référencent.
8. Si une règle de la persona devrait être **garantie** (ex. un nouveau dégoût), vérifie qu'elle est couverte par une garde dans le code (`guards.ts`), pas seulement par le texte. Si non : fiche de tâche pour l'ajouter.
