# CR-07 Topo de la semaine : faits calculés, suggestions rédigées, relues par l'agence
Statut : blocked (clé xAI) (ADR 0042 § 5, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0042)
Dépend de : CR-04, CR-05, CR-06, la passerelle LLM (P3-01) et la clé du fournisseur
Branche : task/cr-07-weekly-brief

## Objectif
Chaque dimanche, la créatrice reçoit un topo et des suggestions qui visent ce qui rapporte le plus sur Reveal, relus et corrigés par l'agence avant de partir.

## Contexte à lire
`docs/adr/0042-creator-space.md` (§ 4, § 5), ADR 0009 (passerelle, règles dans le code), `packages/llm` (prompts versionnés, schémas de sortie, journal `llm_calls`), le plafond de dépense IA, la persona (dégoûts).

## À faire
- [ ] Job `creator.weekly_brief` (dimanche 18 h dans son fuseau, rejouable, un par créatrice et par semaine).
- [ ] Faits calculés par le code : stock de dépôts par usage, publications planifiées et leurs résultats, ventes par contenu, remontées des chatteurs, suggestions ouvertes ou refusées, disponibilités.
- [ ] Prompt versionné et schéma Zod : topo et suggestions (fiches de tournage) à partir de ces seuls faits ; un chiffre absent des faits est refusé ; dégoûts de la persona filtrés par le code ; aucune section « à éviter ».
- [ ] Écran de relecture de l'agence : modifier, déplacer, retirer chaque suggestion sur place, valider la semaine ; départ à la validation ou lundi 8 h, réglage « validation obligatoire ».
- [ ] Carte du lundi chez la créatrice : gains de la semaine, ce qui a marché, suggestions.
- [ ] Évaluation dans `evals/` sur des semaines inventées.

## Critères d'acceptation
- Tests : rejeu sans doublon, chiffre inventé refusé, dégoût jamais suggéré, départ à 8 h sans validation, retenue avec validation obligatoire.
- Coût d'un topo mesuré et noté.

## Hors périmètre
Agent externe par le MCP ; réseaux sociaux.

## Notes de session
