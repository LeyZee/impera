# 2026-11-13 — CHF-01 Chiffres et jeu du chatteur, lot 2a (gains, série, trophées, dévoilement) — in_progress
Fait : module `rewards` (domaine pur : série, gains, trophées, vitrine ; job rejouable `rewards.evaluate` ; routes `GET /v1/rewards/my-trophy-case` et `POST …/reveals`), tables `reward_gains`, `reward_streaks`, `user_preferences` (FORCE RLS), préférence « Sons » (`PUT /v1/me/preferences`), lecteurs `payGameFactsUnscoped` (payroll) et `shiftsForGameUnscoped` (scheduling) branchés par le composition root ; web : écussons, dévoilement à l'arrivée sur Aujourd'hui et Commissions, pastille « Voir » ailleurs, interrupteur « Sons » ; note dans l'ADR 0104, ligne dans `docs/architecture/modules.md`, termes « Gain », « Dévoilement », « Vitrine », « Sons » au glossaire.
Pas fait : lot 2b (défi du shift, niveaux, fiche du membre en lecture), lot 3.
Décisions : aucune ADR nouvelle (note dans 0104) ; `rewards` ne fait que lire la paie et le planning ; « à l'heure » = 12 h après la fin du shift en attendant le choix de Charles.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; les tests d'intégration ne tournent qu'en CI (pas de Docker dans la session) ; captures du lot `jeu-devoilement-1` à valider par Charles.
