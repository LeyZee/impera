# OPS-11 Les évaluations tirent trois fois et passent sur la persona en vigueur
Statut : in_progress
Phase : exploitation
Dépend de : OPS-07
Branche : task/ops-11-evals-draws

## Objectif (1 phrase)

Qu'un résultat d'évaluation ne dépende plus du hasard d'un seul tirage, et qu'on puisse mesurer l'agent sur la persona réellement en vigueur, sur le PC qui tient la base.

## Contexte à lire (fichiers précis)

- `apps/api/src/scripts/evals.ts`, `apps/api/src/scripts/evals/check.ts`, `apps/api/src/scripts/evals/judge-model.ts`.
- `apps/api/src/modules/agent/infra/active-persona.ts` (`activePersonaForModels`).
- `evals/scenarios/price-objection.yaml`, `evals/README.md`.

## Constat (12/11, avis sur le playground validé par Charles, recommandations 7 et 8)

- Chaque scénario est tiré une fois, avec une voix réglée pour varier : 31/35 un soir peut faire 29 ou 33 le lendemain sans rien changer.
- Les évaluations ne passent que sur la persona de démo, jamais sur celle de la créatrice.
- `price-objection` interdit le nombre 10 dans la réponse, même quand elle reprend le « 10 » du fan pour refuser.

## À faire (liste vérifiable)

- [x] `--draws N` (1 à 5, 3 par défaut) : un scénario échoue si un tirage échoue, chaque échec nommé avec son tirage ; notes = moyenne des tirages ; minimum du scénario lu sur le pire tirage, un tirage non noté compte comme non noté (`apps/api/src/scripts/evals/draws.ts`, `mergeDraws`).
- [x] `--persona-from-crm [--creator <id>]` : la persona active lue dans la base de `.env`, sur une connexion en lecture seule ; seuls son nom et son numéro de version s'affichent.
- [x] Plafond d'un passage porté de 3 à 6 € (`EVALS_CAP_EUR`), choix de Charles du 12/11 (carte du fil Bilan).
- [x] `price-objection` : elle peut reprendre le « 10 » pour refuser ; accepter le prix ou parler de remise échoue toujours.
- [ ] Premier passage sur le PC : smoke, trois tirages, persona en vigueur ; comptes seulement dans la PR (jamais les réponses).

## Critères d'acceptation (tests, commandes, comportements observables)

- Tests `draws.test.ts` : un tirage gardé tel quel, échec d'un tirage nommé, moyenne et pire tirage, tirage non noté, passage complet.
- Test `check.test.ts` : `price-objection` laisse passer « 10... t'es sérieux là » et refuse « ok pour 10 », « je te le fais à 10 », « une petite remise ».
- `pnpm check` et `pnpm test` verts.

## Hors périmètre

- Les autres recommandations de l'avis (playground par le composeur de prod, exemples corrigés, notes en base) : fil « Rendre le playground fiable ».
- Le contenu des réponses de l'agent qui font échouer un scénario : fil Agent.
