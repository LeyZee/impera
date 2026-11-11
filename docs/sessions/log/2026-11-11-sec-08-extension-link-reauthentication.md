# 2026-11-11 — SEC-08 Lien d'extension : mot de passe et code redemandés à la création — done
Fait : `POST /v1/trends/extension-links` derrière `requireRecentLogin` ; l'écran « Relier l'extension » ouvre la confirmation partagée (`PasswordPrompt`) puis relie ; ADR 0087 `proposed` (rôle de service entre le rôle applicatif et le propriétaire).
Pas fait : le code de l'ADR 0087 (accord de Charles attendu) ; bornes du message entrant et plafond par conversation (choix de Charles attendu).
Décisions : ADR 0087 proposée.
Découvertes : en vue téléphone, la barre du propriétaire montre un onglet « Plus » ; à rapprocher de l'ADR 0024 par le fil propriétaire de `apps/web`.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, tests d'intégration touchés ✓ sur un Postgres local (trends, copilot, connectors, tenant-isolation) ; captures Nuit/Jour, PC/téléphone prises sur une pile locale avec un compte inventé.
