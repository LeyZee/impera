# 2026-11-11 — OPS-05 Les évaluations lisent la clé posée dans le CRM — done
Fait : `readSavedProviderKeys` (module `providers`) ; option `--key-from-crm` de `pnpm evals`, base ouverte en lecture seule, clé gardée en mémoire ; `evals/run.ts` accepte l'option ; test d'intégration du lecteur ; playbook mis à jour.
Pas fait : rien.
Décisions : aucune ADR (ADR 0016 : la clé reste là où le propriétaire l'a collée).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ ; test d'intégration laissé à la CI (pas de Docker dans la session).
