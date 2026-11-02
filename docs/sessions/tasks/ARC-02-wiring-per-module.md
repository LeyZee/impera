# ARC-02 L'assemblage module par module
Statut : done
Phase : exploitation
Dépend de : ADR 0047 § 3
Branche : claude/project-thread-fjrft0 (fil « Ranger l'architecture »)

## Objectif (1 phrase)

`composition-root.ts` ne garde que l'ordre d'assemblage et les dépendances communes ; chaque module est construit par son fichier `apps/api/src/wiring/<module>.ts`, partagé par l'API et le worker (ADR 0047 § 3).

## Contexte à lire (fichiers précis)

- ADR 0047 § 3, `docs/conventions/coding.md`.
- `apps/api/src/composition-root.ts`, `eslint.config.js` (`boundaries/elements`).

## À faire (liste vérifiable)

- [x] Un fichier `wiring/<module>.ts` par module : il construit le module, ses routes et les jobs nommés d'après lui (`TasksOf<'payroll'>` n'accepte que `payroll.*`).
- [x] `composition-root.ts` : bases, file, authentification, journal et budget des appels IA, chemins qui dépendent de l'endroit où tourne le paquet, ordre d'assemblage, liste complète des jobs typée (un job oublié ne compile pas).
- [x] ESLint : élément `api-wiring` ; seul `composition-root.ts` l'importe ; un fichier de `wiring/` n'atteint un module que par son `index.ts`.
- [x] `coding.md` mis à jour.

## Critères d'acceptation (tests, commandes, comportements observables)

- Aucune route, aucun job, aucun comportement ne change : `pnpm check`, `pnpm test:all` et la CI verts sans test retiré ni modifié.

## Hors périmètre

- Le découpage de la paie (ADR 0047 § 1), qui ajoutera `wiring/invoicing.ts`, `wiring/contractors.ts` et `wiring/accounting.ts`.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 02/11 : les chemins des polices de factures et des personas restent dans `composition-root.ts` : le paquet de production (tsup) les lit depuis `dist/index.js`, au même niveau que `src/composition-root.ts`, pas depuis `src/wiring/`.
- 02/11 : fusionnée (#395, 6057395).
