# 2026-11-01 — Réglages › Facturation : SIREN et numéro de TVA de l'agence vérifiés à l'enregistrement (fil Bilan) — done
Fait : `BillingAgencyBodySchema` refuse un SIREN dont la clé de contrôle (Luhn) est fausse, et un numéro de TVA qui n'est pas celui que ce SIREN donne (`FR` + clé (12 + 3 × (SIREN mod 97)) mod 97 + SIREN). Les deux fonctions, `sirenChecksOut` et `frenchVatNumberOf`, sont exportées par `@nirvana/contracts`. `InvoiceAgencySchema`, qui relit les copies figées des factures, ne change pas : une copie déjà faite se lit telle quelle. Les jeux de test qui enregistrent des réglages prennent des numéros inventés à clé juste.
Pas fait : le dossier du prestataire (`businessId`, SIREN ou SIRET, et son numéro de TVA) n'a pas encore ce contrôle ; l'aperçu du pied de page recopié dans apps/web (sujet d'une autre PR).
Décisions : un numéro de TVA étranger est refusé pour l'agence. Une société qui a un SIREN a toujours le numéro FR qu'il donne.
Découvertes : le `model.ts` de Réglages › Facturation dans apps/web (#343) recalcule les mêmes règles (`isSiren`, `vatOfSiren`) ; il peut importer celles du contrat une fois les deux PR fusionnées, et ne plus proposer de garder un numéro étranger.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests contracts et intégration Réglages › Facturation ✓.
