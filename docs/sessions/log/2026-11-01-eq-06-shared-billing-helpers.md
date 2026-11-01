# 2026-11-01 — EQ-06 : helpers de facturation partagés dans les contrats (fil Équipe) — done
Fait : le pied de page des factures et des avoirs (art. R123-237 C. com.) vit dans `@nirvana/contracts` (`invoiceFooterOf`, avec `addressLines`, `legalFormWords`, `shareCapitalWords` et `sirenWords`) ; le PDF de la paie et l'aperçu de Réglages › Facturation l'importent, et leurs deux copies disparaissent (`footerOf`, `capital` et `addressLines` dans `invoice-pdf.ts`, `footText`, `formLine`, `capitalText` et `sirenText` dans le `model.ts` de l'écran). Le contrôle du SIREN et le numéro de TVA de l'écran passent par `sirenChecksOut` et `frenchVatNumberOf` (#344) ; `isSiren` et `vatOfSiren` ne font plus qu'ôter les espaces et les points qu'un propriétaire tape. Le texte imprimé ne change pas : les tests du PDF passent sans retouche.
Pas fait : rien de ce sujet.
Décisions : l'adresse se découpe sur `\r\n` comme sur `\n` des deux côtés (le PDF le faisait déjà, l'aperçu non). Le test du pied de page passe des tests de l'écran à ceux des contrats ; `BillingSection.test.tsx` vérifie toujours le texte affiché.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests contracts (invoices), payroll (invoice-pdf) et web (settings/billing) ✓ ; pnpm check et pnpm test au pre-push.
