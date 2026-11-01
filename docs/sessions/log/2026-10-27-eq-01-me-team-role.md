# 2026-10-27 — EQ-01 : le rôle d'équipe dans `/v1/me` — done
Fait : contrat `MeSchema` (`CurrentUserSchema` plus `team` et `teamScope`) et `TeamMembershipSchema` dans `packages/contracts/src/team.ts`. `GET /v1/me` lit la ligne `team_members` du compte par `withMember`, qui donne aussi le scope : c'est celui que les politiques de la base appliquent, sans second calcul. `createAuthRoutes` reçoit la base par le composition root. Fiches EQ-01 et EQ-11 mises à jour.
Pas fait : le module `team` et ses routes, le filtre serveur des conversations routées au chatteur, la partie serveur d'EQ-10.
Décisions : `team` vaut `null` pour le propriétaire, une créatrice ou un compte hors équipe (aucune ligne) ; une ligne qui ne se valide pas fait échouer la requête, comme dans `withMember` (pas de rôle deviné).
Découvertes : `apps/web` lit encore `/v1/me` avec `CurrentUserSchema` ; les nouveaux champs y sont ignorés et rien ne casse. EQ-11 passera à `MeSchema`.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ ; contrats (`team.test.ts` : forme, jeton absent, rôle et scope inconnus refusés) ; intégration `auth.integration.test.ts` (propriétaire `owner`, compte hors équipe `self`, manager actif `agency`, manager en congé `self`, chatteur `self`).
