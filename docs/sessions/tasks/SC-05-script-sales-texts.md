# SC-05 Textes de vente d'un script, proposés par le modèle et validés par l'agence
Statut : blocked (clé xAI ; grille de prix P6-01)
Phase : scripts (ADR 0056)
Dépend de : SC-04, la passerelle LLM (P3-01), les gardes de voix (P3-13), P6-01
Branche : task/sc-05-script-texts

## Objectif
Pour chaque étape, le modèle propose le texte de l'offre, deux ou trois idées de relance, la bulle de renfort et la question d'après achat, dans la voix de la créatrice et selon la méthode ; l'agence relit et valide.

## Contexte à lire
ADR 0056 § 6, la méthode de chatting et le skill `chatting-ecrire-script` (hors dépôt), `packages/llm`, `evals/`.

## À faire
- [ ] Prompt versionné et schéma Zod de sortie ; le texte de l'offre cite un détail concret des descriptions validées.
- [ ] Ressorts de la méthode inscrits dans la structure (participer, patienter, peu d'offres, aftercare) et vérifiés par le code là où c'est possible.
- [ ] Prix lus dans la grille de l'agence par structure, jamais produits par le modèle ; avertissements de P6-01.
- [ ] Écran de relecture par étape ; versions gardées.
- [ ] Évaluations dans `evals/` (scénarios inventés).

## Critères d'acceptation
- Tests : aucun prix dans la sortie du modèle ; texte sans détail du média refusé ; gardes de voix appliquées.
- Relecture du fil Agent (méthode, voix).

## Hors périmètre
Tout nouveau montant ou règle d'argent : à demander à Charles.

## Notes de session
