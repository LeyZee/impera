# 2026-11-03 · Découpage de `packages/contracts/src/invoices.ts` (Bilan)

- Fiche : aucune ; demande de Charles (03/11 10h38, « Start with packages/contracts/src/invoices.ts… », puis « go invoices » à 10h59) sur le plan du fil Floorplan.
- Fait : `invoices.ts` (1 511 lignes) devient un index de ré-export de dix fichiers à une seule tâche : `invoices-vocabulary`, `invoices-fields`, `invoices-parties`, `contractor-file`, `contractor-file-api`, `billing-settings`, `invoices-documents`, `invoices-api`, `invoices-accounting`, `invoices-errors`. Un commit par étape, déplacements mécaniques, aucun texte de code modifié.
- Écart au plan : `trimmed` et `dayNumber`, privés et utilisés par plusieurs fichiers, vont dans `invoices-internal.ts`, que l'index ne ré-exporte pas ; ils restent hors de l'API des contrats.
- Vérifié à chaque étape : `tsc`, ESLint et `invoices.test.ts` (inchangé) ; les 244 exports publics comparés par le vérificateur de types avant et après (mêmes noms, mêmes types ; seul l'ordre d'impression de quelques unions change). À la fin : `pnpm check` et `pnpm test` verts.
- Reste : les huit autres gros fichiers de la liste de Charles, chacun avec son plan d'abord.
- Découvertes : aucune.
