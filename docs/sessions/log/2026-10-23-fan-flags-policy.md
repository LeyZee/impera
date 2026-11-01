# 2026-10-23 — Mémoire du fan : la politique pose les drapeaux sur un risque (P3-02, PR 6) — done

Fait : `protectionFor` (`agent/domain/hold.ts`) : `minor_suspected` ou `possible_minor` retire l'âge confirmé ; `distress`, `self_harm`, `real_abuse`, `harassment`, `dangerous_request` ou `weapon` pose `doNotContact`. Port `FanLimits` et adaptateur `createFanLimits` (`agent/infra/fan-limits.ts`) sur le module `fans`, auteur `system`, raison = les risques. Le composeur lit les drapeaux avant tout appel : « ne plus écrire » ou des limites illisibles passent la main sans rien écrire ; sur un `handoff` dû à un risque (cerveau ou média), il pose les limites puis passe la main, même si l'écriture échoue (`limits_not_saved`). `AgentComposeInput` porte `fanId` et `correlationId` (déjà dans le `ComposeInput` de `conversations`). Une ligne dans `composition-root.ts` : `fans` passé à `startDraftComposer`.

Pas fait : rien pour cette PR.

Décisions : les drapeaux ne sont posés que sur une passation de main : un risque sans passation (`harassment` seul) ne coupe pas le fan en silence. Un fan « ne plus écrire » qui écrit de nouveau va chez un chatteur (passation) plutôt que d'être ignoré.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `apps/api` complète contre Postgres 16.
