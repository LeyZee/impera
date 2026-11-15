# REC-CREA-01 Bac à sable : grosses requêtes de vision et transcription
Statut : done
Phase : recette
Dépend de : ADR 0075 (bac à sable de recette), recette créatrice du 11/11/2026 (anomalie 9)
Branche : task/rec-crea-01-sandbox-large-vision-and-transcription

## Objectif (1 phrase)

Que le faux monde du bac à sable prenne les médias aussi gros que ceux que l'API envoie et réponde à la transcription de xAI, pour qu'une vidéo de téléphone et un vocal se jouent en recette.

## Contexte à lire (fichiers précis)

- Rapport de la recette créatrice du 11/11/2026, anomalie 9 (hors dépôt).
- `apps/api/src/__tests__/sandbox-world/world.ts`, `ai-generation.ts`, `world.test.ts`.
- `packages/llm/src/sense-content.ts` (vidéo envoyée entière jusqu'à 20 Mio), `packages/llm/src/providers.ts` (`createTranscriberResolver`), `apps/api/src/modules/media/domain/media.ts` (image de 20 Mio au plus), `apps/api/src/modules/agent/infra/media-sight.ts` (média d'un fan de 20 Mio au plus).
- `docs/recette/bac-a-sable.md`.

## À faire (liste vérifiable)

- [x] Limite de corps du faux monde réglée sur celle de l'API : un média de 20 Mio (`INLINE_VIDEO_MAX_BYTES`, désormais exporté par `@impera/llm`) en base64, plus 1 Mio pour les prompts, soit 27,7 Mio (`WORLD_BODY_LIMIT`). Avant : 1 Mio par défaut de Fastify, d'où le 413.
- [x] `POST /xai/v1/stt` en `multipart/form-data`, la forme qu'envoie `@ai-sdk/xai` : la même phrase inventée en français, `language: "fr"`, `duration: 0` (journal à 0 $). Avant : aucun lecteur pour ce type, d'où le 415. Règle des mots de la clé comme pour la génération.
- [x] Tests dans `world.test.ts`, par la vraie passerelle : une photo de 2 Mio et une image de 20 Mio décrites (200), une vidéo 720p (Google en panne, repli xAI sur ses images clés), un vocal transcrit et lu par le vrai fournisseur, une requête au-delà de la limite refusée (413), une transcription sans son (400) ou avec une clé refusée.
- [x] `docs/recette/bac-a-sable.md` : la limite et la transcription.

## Critères d'acceptation (tests, commandes, comportements observables)

- Les cinq nouveaux cas échouent sur l'ancien faux monde et passent sur le nouveau.
- `pnpm check` et `pnpm test` verts ; aucune migration.

## Hors périmètre

- La génération par Google (toujours 503, le repli passe par xAI).
- Les anomalies 1 à 8 et 10 de la même recette.

## Notes de session

- Le faux monde garde la même phrase pour tout son entendu : une recette relit toujours le même texte.
