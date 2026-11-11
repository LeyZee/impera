# OPS-04 Plantage journalisé, repli d'écriture épinglé, prix relus
Statut : done
Phase : exploitation
Dépend de : —
Branche : claude/project-thread-whk8fg (fil « Auditer l'architecture et la fiabilité »)

## Objectif (1 phrase)

Appliquer, sans changer le métier, les points de l'audit d'architecture et de fiabilité du 11/11/2026 qui ne demandent ni décision de Charles ni un autre chantier.

## Contexte à lire (fichiers précis)

- `docs/architecture/operations.md` (arrêt, verrous d'un worker mort), `docs/reference/llm-providers.md`, ADR 0009.
- `packages/llm/src/config.ts`, `packages/llm/src/catalog.ts`, `apps/api/src/shutdown.ts`.

## À faire (liste vérifiable)

- [x] Une erreur non attrapée ou une promesse rejetée sans suite est écrite dans le journal structuré avant l'arrêt du processus, dans l'API et dans le worker.
- [x] Le modèle de repli de la voix et du cerveau est un modèle précis (`mistral-large-4`), plus l'alias mobile ; la vérification d'une clé Mistral demande ce modèle ; le juge des évals et le bac à sable suivent.
- [x] Les prix de Grok 4.7 et de Mistral Large 4 sont relus sur les pages des fournisseurs, avec le palier « long contexte » de xAI.

## Critères d'acceptation (tests, commandes, comportements observables)

- `crash.test.ts` : la ligne `process crashed` porte l'origine et la pile ; Node prévient bien le moniteur pour une erreur comme pour une promesse, et sort en échec.
- `llm.test.ts` : le repli de la config, celui que vérifie la clé et la constante sont le même modèle, sans `latest`.
- `verifiers.test.ts` : une clé qui ne voit qu'un autre Mistral Large est refusée (`model_not_allowed`).
- `catalog.test.ts` : chaque modèle d'un rôle a un prix ; une requête de 200 000 jetons de prompt est comptée au tarif long.
- `pnpm check`, `pnpm test` et la CI verts.

## Hors périmètre

- Le plafond d'appels par conversation : fil de l'audit de sécurité.
- L'idempotence de l'envoi vers Reveal : P2-03.
- Déploiement, sauvegardes réelles, clés des fournisseurs, évals jouées : gestes de Charles.
- Un service de suivi d'erreurs externe : dépendance et compte nouveaux, à décider par Charles.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Le moniteur (`uncaughtExceptionMonitor`) ne change pas le comportement de Node : pas d'arrêt gracieux après une erreur inconnue, pour ne rien envoyer ni écrire deux fois.
- Le prix de Gemini 3.8 Flash n'a pas pu être relu sur la page de Google le 11/11 : inchangé.
- L'ancien prix de Mistral surestimait la dépense : le plafond coupait trop tôt, jamais trop tard.

## Résultat

Fait : les trois points. Reste : rien dans ce périmètre.
