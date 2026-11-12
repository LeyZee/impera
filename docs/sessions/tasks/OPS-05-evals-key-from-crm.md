# OPS-05 Les évaluations lisent la clé posée dans le CRM
Statut : done
Phase : exploitation
Dépend de : ADR 0016 (clés posées dans le CRM), P3-03
Branche : task/ops-05-evals-key-from-crm (fil « Bilan »)

## Objectif (1 phrase)

Lancer `pnpm evals` sur le PC de Charles avec la clé xAI qu'il a collée dans Réglages › Modèles IA, sans jamais l'écrire dans un fichier ni l'afficher.

## Contexte à lire (fichiers précis)

- `apps/api/src/scripts/evals.ts`, `evals/run.ts`.
- `apps/api/src/modules/providers/index.ts`, `apps/api/src/modules/providers/infra/postgres.store.ts`.
- `apps/api/src/key-check.ts` (`READ_ONLY_POOL_OPTIONS`).

## À faire (liste vérifiable)

- [x] `readSavedProviderKeys(adminDb, keys)` dans le module `providers` : les clés enregistrées que ces clés de chiffrement ouvrent, par service ; une clé qui ne s'ouvre pas est laissée de côté.
- [x] `pnpm evals --key-from-crm` : lit `DATABASE_ADMIN_URL` et `CREDENTIALS_ENCRYPTION_KEYS` du `.env`, ouvre la base en lecture seule, garde les clés en mémoire sous les noms que lit la passerelle, n'écrit que le nom des services trouvés.
- [x] `evals/run.ts` ne refuse plus de démarrer sans `LLM_XAI_API_KEY` quand l'option est donnée.
- [x] `evals/run.ts` démarre sous Windows (`pnpm` y est un `.cmd`, lancé par un shell) et dit son erreur au lieu de sortir sans message.
- [x] Test d'intégration du lecteur (clé ouverte, clé scellée par une autre clé de chiffrement laissée de côté).

## Critères d'acceptation (tests, commandes, comportements observables)

- Sur le PC, `pnpm evals --key-from-crm` affiche « Clés lues dans le CRM : xAI » et joue la suite, plafonnée à 3 € (`EVALS_CAP_EUR`).
- Aucune clé dans la sortie, un fichier ou le journal.
- `pnpm check` et la CI verts ; aucune migration.

## Hors périmètre

- La nuit de la CI : elle garde le secret `LLM_XAI_API_KEY` du dépôt.
