# P3-05 Boucle de calibrage dans le playground
Statut : in_progress
Phase : 3 (demande de Charles du 17/10, 18h33, spec validée à 18h37)
Dépend de : P3-04
Branche : claude/project-thread-e0j3ow

## Objectif
Charles et Messa entraînent le bot dans le playground : ils notent chaque réponse, la corrigent ou la rejettent avec une raison, mettent le fan en situation, rejouent et comparent, et suivent un seul chiffre, le taux au playground (objectif 80 %, ADR 0019). Le moteur et le terminal d'abord ; l'écran Entraîner du CRM se branchera sur ce même code (fil Extension).

## Contexte à lire
`CLAUDE.md`, `docs/architecture/ai-engine.md`, la spec `/mnt/project-files/moteur-ia/playground-entrainement.md` (sections 2 à 6 et 8), `apps/api/src/scripts/playground.ts`.

## À faire
- [x] Notes : valider, corriger (la réponse réécrite), rejeter avec une raison parmi sept ; destination proposée (exemple de voix, règle à valider, test).
- [x] Taux au playground : part des réponses validées sans retouche parmi les 50 dernières notées, par version du prompt de voix et modèle, avec la tendance sur la version précédente.
- [x] Mise en situation : préréglages de fan fictifs, heure de la créatrice (jour ou nuit), ancienneté de la relation, montant dépensé ; donnés au cerveau et à la voix dans une section « Le moment » écrite par le code (prompts 1.4.0).
- [x] Horloge simulée : avancer d'une heure ou d'un jour.
- [x] Rejouer depuis un message du fan ; comparer la dernière réponse avec un autre modèle de voix.
- [x] Corrections gardées hors dépôt (`.scratch/training/`, ou `IMPERA_TRAINING_DIR`), un enregistrement par note, dans le format que la base reprendra (P0-03) ; les réponses corrigées reviennent comme exemples de voix à la session suivante ; les tests se rejouent d'une commande.

## Critères d'acceptation
- `pnpm check` et `pnpm test` verts ; tests unitaires du taux, des destinations, des raisons, de la situation (jour, nuit, fuseau), du magasin JSONL et des commandes de session (rejouer, comparer, contexte).
- Sans clé, rien ne change pour le reste du dépôt.

## Hors périmètre
L'écran du CRM (fil Extension), la base (P0-03), le juge IA qui pré-note, le Coach sur les vraies conversations (spec, section 9), les règles de politique codées (sexualisation, relances).

## Reste
- Calibrer pour de vrai avec `LLM_XAI_API_KEY` : Charles et Messa notent une cinquantaine de réponses par préréglage.
- Brancher l'écran Entraîner du CRM sur ce code (fil Extension) et les notes sur la base (P0-03). Écran en cours (journal `2026-10-17-web-coquille-playground.md`), en mode démo jusqu'aux routes P3-06.
- Construire la passerelle dans `composition-root` au branchement de l'agent sur `conversations` (après P0-05, accord du coordinateur), avec les clés du CRM : `credentials: app.modules.providers.apiKeySource` et `onKeyRefused: ({ provider, status }) => { void modules.providers.reportRefusedKey(provider, status === 401 ? 'unauthorized' : 'missing_permission').catch((err) => logger.warn({ err, provider }, 'key refusal not recorded')); }` (convenu avec le fil Connecteurs, 17/10).
