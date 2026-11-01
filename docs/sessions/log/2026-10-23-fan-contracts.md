# 2026-10-23 — Mémoire du fan : contrats des slots KYC et des drapeaux (P3-02, PR 2 sur 4) — done

Fait : `packages/contracts/src/fans.ts` : `KycSlotSchema` (les lignes du canevas de notes de Reveal : `first_name`, `location`, `age`, `job`, `hobbies`, `desires`, `situation`) et `KYC_SLOT_LABELS` (Prénom… Situation) ; `FanFlagsSchema`, clés fermées de `fans.flags` (`ageConfirmedAt`, `salesFrozen` avec sa raison, `spendingLimitMinor`, `fragile`, `noExplicit`, `doNotContact`) ; tests. Glossaire (« Drapeau du fan », « Slot KYC ») et `data-model.md`.

Pas fait : `operator_note` dans `FactCategory` : il change le check de `fan_facts`, donc une migration (0014, Bilan), à faire avec `release(…, note)` (PR 3). Rien ne lit encore les drapeaux (PR 4).

Décisions : clés jsonb en camelCase (convention de `P0-03`) plutôt que les noms snake_case de la fiche ; un drapeau vaut `true` ou est absent, jamais `false`.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`.
