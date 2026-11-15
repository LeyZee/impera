# 2026-11-14 — MCP lot a, PR 1 : l'acteur d'un compte lu par son identifiant — done
Fait : `resolveActor` dans `apps/api/src/auth.ts` (utilisateur, créatrices routées et du shift, équipe, second facteur), même calcul que `requireRole` ; `currentUserById` (lien d'extension) passe par lui, sans changement de comportement ; test d'intégration.
Pas fait : le module `mcp` (PR 2 : domaine pur), la table des accès et le transport (attendent ADR 0087, #716).
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, intégration `resolve-actor`, `auth`, `copilot`.
