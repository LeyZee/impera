# 2026-11-06 · recette SEC-03 : un code du deuxième facteur ne sert qu'une fois

- Fil : Bilan. Branche `claude/project-thread-a8l1w6`.
- Fait : un code de l'application d'authentification est pris une seule fois, à la connexion (`/v1/auth/two-factor/verify-totp`) comme à une confirmation (`/v1/auth/reauthenticate`, nouveaux codes de secours) ; réutilisé dans les 120 s, il est refusé comme un code faux et compté dans les refus. Ligne `verification` `totp-spent-<sha256(compte:code)>`, la clé primaire rend deux prises simultanées une seule ; un code que Better Auth refuse est rendu. Sans migration.
- Tests : `second-factor.integration` (le même code refusé à la connexion et à la confirmation, un code neuf passe). Les aides de test tapent un code neuf à chaque fois (`codeFor`) et attendent le suivant, 30 s au plus, quand les trois acceptés à l'instant sont pris, comme une personne ; `testTimeout` des tests d'intégration passé à 120 s pour ces attentes. Suite d'intégration verte en local (hors les deux fichiers qui exigent Docker).
- Décisions : aucune session réutilisée par les aides (une session gardée change ce que vérifient les tests de connexion récente, dont l'horloge est injectée) ; l'attente est le prix de la règle.
- Découvertes : la suite d'intégration prend environ une minute de plus, surtout `second-factor.integration`.
