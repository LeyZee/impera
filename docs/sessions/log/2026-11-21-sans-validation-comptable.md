# 2026-11-21 — Paie : la validation du comptable n'est plus une garde — done
Fait : une facture ne part plus seulement sous un régime validé par le comptable. La garde est retirée du domaine (`issueDecision`) et de la base (migration 0291, `keep_invoice` sans la vérification) ; écrans sans ambre ni « À valider » sur un régime non noté ; tests unitaires, d'écran et RLS mis à jour ; ADR 0023 amendée, fiche EQ-17 et README de la facturation à jour.
Pas fait : rien.
Décisions : Charles, 21/11/2026 : retirer la validation du comptable (« J'ai peur que ça me bloque »). Elle reste une note facultative.
Découvertes : le motif `regime_not_validated` reste dans le vocabulaire pour les décisions déjà écrites ; à retirer le jour où aucune ligne ne le porte.
Candidats à suppression : aucun.
Vérifié : tests web et API des modules touchés ✓ ; intégration RLS des factures ✓ ; pnpm check et pnpm test au pre-push.
