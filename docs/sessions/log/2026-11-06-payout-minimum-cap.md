# 2026-11-06 — Le minimum de versement plafonné à 5 000 € (question de paie 17, réponse de Charles du 06/11)

Fait :
- Contrat : `PAYOUT_MINIMUM_MAX_MINOR` (500 000 centimes). Seul le corps de `POST /v1/payroll/payout-minimums` le prend. Les lectures (`PayoutMinimumSchema`, `PayrollSettingsSchema`) gardent l'ancienne borne, pour qu'un minimum écrit avant se lise toujours.
- Base : migration 0127. `payout_minimums_minimum_check` et `payroll_settings_minimum_check` passent à 500 000 centimes, en `NOT VALID`.
- Écran (Réglages › Règles de paie › Minimum de versement) : au-delà, « Au plus 5 000,00 € ».
- Tests : contrat (5 000 € passe, 5 000,01 € non, un ancien minimum plus haut se lit), API (400, puis refus de la base pour une écriture directe), écran.
- README de la paie, note dans EQ-04.

Pas fait : rien.

Décisions :
- Une garde contre la faute de frappe, pas un plafond de paie : rien ne borne ce qu'un relevé verse (Charles : « Jamais un chatter j'ai versé 50 000 € »).
- `NOT VALID` plutôt qu'une contrainte validée : une base locale qui aurait un minimum plus haut ne refuse pas la migration, et le passé des minima (ajout seul) reste tel qu'il a été écrit.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `payroll-rules`.
