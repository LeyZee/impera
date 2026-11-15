# 2026-11-11 — REC-CREA-01 Bac à sable : grosses requêtes de vision et transcription — done
Fait : le faux monde prend une requête jusqu'à 27,7 Mio (un média de 20 Mio, la limite de l'API, en base64, plus 1 Mio de prompts) au lieu du 1 Mio de Fastify (413) ; il répond à la transcription de xAI (`POST /xai/v1/stt`, `multipart/form-data`) par une phrase inventée en français et une durée de 0 s (415 avant). `INLINE_VIDEO_MAX_BYTES` est exporté par `@impera/llm` pour que la limite suive celle de la passerelle. Doc du bac à sable à jour.
Pas fait : la génération par Google reste en panne simulée (503), le repli xAI fait le travail.
Décisions : aucune ADR.
Découvertes : la limite de 20 Mio est écrite trois fois (`INLINE_VIDEO_MAX_BYTES` dans `packages/llm`, `DROP_VIDEO_INLINE_MAX_BYTES` dans `media/application/describe-drop.ts`, `VISION_IMAGE_MAX_BYTES` dans `media/domain/media.ts`) ; `scripts/check-repo.mjs` ne reconnaît pas un ID de fiche à deux mots (`REC-CREA-01`), qui échappe donc au contrôle de l'index.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ ; les cinq nouveaux cas échouent sur l'ancien faux monde.
