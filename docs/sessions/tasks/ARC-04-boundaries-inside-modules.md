# ARC-04 Les frontières vérifiées aussi à l'intérieur d'un module
Statut : todo
Phase : exploitation
Dépend de : ARC-03 fusionnée (ADR 0051, couche `pure.ts`)
Branche : task/arc-04-boundaries-inside-modules

## Objectif (1 phrase)

Le lint refuse qu'un `domain/` importe l'`infra/` ou l'`application/` de son propre module, comme il le refuse déjà entre modules (règle 2 de `CLAUDE.md`, ADR 0002).

## Contexte à lire (fichiers précis)

- `eslint.config.js` (`boundaries/dependencies`, `moduleRules`), `apps/api/src/__tests__/boundaries.test.ts` et ses fixtures.
- ADR 0002, ADR 0047, ADR 0051 ; `docs/conventions/coding.md`.

## Constat

`eslint-plugin-boundaries` 7 ne vérifie pas les imports entre fichiers d'un même élément quand `checkInternals` vaut `false` (défaut). Les couches d'un module sont capturées dans un seul élément `module` : « `domain/` n'importe que son domaine » ne vaut donc qu'entre modules, et un `domain/` qui importe son propre `infra/` passe le lint aujourd'hui (découverte du fil Floorplan, relecture de la #406).

## À faire (liste vérifiable)

- [ ] Activer la vérification interne (`checkInternals`, ou des éléments par couche) sans désactiver aucune règle existante.
- [ ] Corriger ce qu'elle trouve dans `apps/api/src/modules/*`, sans changer de comportement ; un écart qui demanderait une décision part en question, pas en contournement.
- [ ] Fixtures et cas dans `boundaries.test.ts` : un `domain/` qui importe son `infra/` ou son `application/` est refusé ; `application/` vers `domain/` et `infra/` vers les deux restent permis.
- [ ] `coding.md` dit que la règle vaut aussi à l'intérieur d'un module.

## Critères d'acceptation (tests, commandes, comportements observables)

- `pnpm check`, `pnpm test:all` et la CI verts sans test retiré ; les nouveaux cas de `boundaries.test.ts` échouent si la vérification interne est retirée.
- Aucune migration, aucun changement de route ni de job.

## Hors périmètre

- Le découpage de la paie (ARC-03 et suivantes) ; `apps/web` et `apps/extension`.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)
