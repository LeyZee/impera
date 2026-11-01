# D-02 Recette design et navigation de l'interface web

Statut : in_progress
Phase : 4
Dépend de : D-01
Branche : claude/project-thread-f2aif1 (une PR par écran, en série)

## Objectif
Demande de Charles du 28/10/2026 : une passe « parfaite » sur apps/web pour que la hiérarchie de l'information soit nette, que rien ne soit inutile, que la navigation soit fluide et intuitive, que tout soit lisible et cohérent avec le design system.

## Contexte à lire
`docs/design/README.md`, `packages/design-system`, ADR 0011 (euros), ADR 0024 (rails par rôle, pas d'onglet vide), `docs/glossary.md`. Rapport de recette (hors dépôt) : https://claude.ai/artifact/HoANj9hhHHLZj1LQJCCqGX, 214 constats classés par écran, gravité (bloquant, gênant, mineur) et nature (visuel, métier).

## À faire
- Corriger les constats visuels, écran par écran : Paie et Commissions, Suivi, Entraîner, Créatrices (persona, heures), Réglages, puis coquille et navigation, Dashboard et Équipe une fois fusionnées les PR de la recette fonctionnelle qui touchent ces fichiers.
- Ne coder un constat métier (retrait d'une information, droit d'un rôle, règle, contrat d'API) qu'après la réponse de Charles ; ceux qui touchent l'API passent par Bilan.

## Critères d'acceptation
- Chaque PR liste les constats faits et reportés ; captures avant et après en Nuit, Jour et téléphone.
- Jetons et classes `nv-*` seulement, un seul néon par écran, rouge réservé aux urgences, ambre aux avertissements.
- `pnpm check` et `pnpm test` verts.

## Hors périmètre
Les bugs fonctionnels de la recette du 28/10 (fil « Recette complète ») ; tout changement d'API non validé.

## Notes de session
