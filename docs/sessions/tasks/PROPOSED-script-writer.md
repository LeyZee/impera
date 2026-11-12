# Rôle `script_writer` : l'IA écrit les textes d'un script à partir des médias décrits
Statut : proposed (ID à donner ; ADR 0100 ; propriétaire proposé : Agent, `packages/llm` et module `agent`)
Phase : 6
Dépend de : ADR 0098, SC-04 c8 (identité de script unique, #708), `PROPOSED-vault-import-scripts.md`
Branche : task/<id>-script-writer

## Objectif
Pour un ensemble de médias validés, le rôle `script_writer` propose les textes d'une séquence dans la voix de la persona, et le code refuse tout ce qui enfreint la vente.

## Contexte à lire
ADR 0100, ADR 0098, ADR 0009, ADR 0010, ADR 0021, `packages/llm/prompts/`, skill de méthode de script de l'agence (hors dépôt).

## À faire
- [ ] Prompt versionné et schéma de sortie Zod : textes par segment (offert, payant, pont) avec clés de segment stables (ADR 0098) ; pour chaque texte, les clés des médias qu'il annonce ou teaste (remarque Médias sur 0100, point 2) ; identité du script au schéma c8, sans second format.
- [ ] Entrée du prompt : seules les descriptions validées, jamais une ligne `platform` ni une `sense` non validée (point 3).
- [ ] Contrôles en code : aucun prix dans le texte ; média annoncé absent de l'étape refusé ; gardes dures de la voix (`ai_disclosure`, hors plateforme, rencontre, remise, promesse de relation) avant enregistrement ; vocabulaire au présent.
- [ ] Appel journalisé dans `llm_calls`, compté dans le budget du jour ; rien pour une créatrice archivée.
- [ ] Évals dans `evals/` sur une persona fictive : voix, présent, aucune invention hors description.

## Critères d'acceptation
- Tests du domaine : texte avec prix refusé, média absent refusé, garde `ai_disclosure` bloquante, identité manquante = script non créé.
- `pnpm evals` passe sur les scénarios du rôle.

## Hors périmètre
Écran de relecture, appel d'écriture Reveal.

## Notes de session
