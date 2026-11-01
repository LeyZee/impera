# 2026-10-27 — Note sur les colonnes jsonb — done
Fait : `docs/architecture/jsonb.md` fixe la règle (colonne si le code filtre ou décide sur la valeur, jsonb + Zod sinon, parse à l’écriture, `CHECK jsonb_typeof` sur ce qu’on garde) et l’ordre des changements : `connector_config.writes` en colonne, puis `drafts.prompt_hashes` en `voice_prompt` / `voice_model`, puis Zod à l’écriture et `CHECK` sur les payloads d’événements et `platform_media`, puis le reste. `data-model.md` et `00-START-HERE.md` y renvoient.
Pas fait : aucune migration (demande de l’audit : une note, pas de migration maintenant) ; chaque ligne du tableau sera sa propre PR.
Décisions : 24 colonnes jsonb à nous, pas 33 ; douze sont mortes et leur suppression (`DROP`) attend une ADR et le mot de Charles (règle 12).
Découvertes : `ConnectorConfigSchema.catch(…)` remplace une config illisible par les défauts sans le dire, garde `writes` comprise ; `drafts.brief` illisible devient `[]` en silence.
Candidats à suppression : les douze colonnes mortes listées dans la note (ADR à écrire).
Vérifié : pnpm check ✓ ; chaque affirmation de la note recoupée par `rg` dans `apps/api/src` et `packages/*/src`.
