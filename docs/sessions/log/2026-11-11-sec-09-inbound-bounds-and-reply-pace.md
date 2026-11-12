# 2026-11-11 — SEC-09 Message de fan borné, rythme ralenti passé 60 réponses dans l'heure — done
Fait : `respondAt` (60 réponses dans l'heure au rythme habituel, puis une toutes les 3 minutes depuis la dernière) branché sur `ingestMessage` par `drafts.paceSince` ; `boundFanText` (4 000 caractères) et `FAN_MEDIA_MAX` (20) à l'ingestion d'un message de fan ; `security.md` § 4 et `message-flow.md` § 1.
Pas fait : réglage de ces valeurs depuis le CRM ; plafond de dépense par fan.
Décisions : aucune ADR ; valeurs choisies par Charles (carte du 11/11).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, `conversations.integration.test.ts` ✓ sur un Postgres local.
