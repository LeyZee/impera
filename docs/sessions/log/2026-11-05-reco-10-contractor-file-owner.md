# 2026-11-05 — Recette, reco 10 : le dossier d'un prestataire n'est lu que par lui et le propriétaire — done

Fait :

- `GET /v1/payroll/contractors/:memberId/file` et `GET …/documents/:documentId/file` refusent un manager actif sur le dossier d'un autre membre : `contractor_profile_forbidden` (403), « Seuls le prestataire et le propriétaire lisent ce dossier ». Il lit toujours le sien (Moi › Dossier).
- L'API dit donc ce que disent les écrans : la route `/equipe/membres/$id/dossier` est réservée au propriétaire depuis EQ-06 lot 8b (question 5 de la recette Équipe, reco 10 validée par « GO RECOS »).

Décisions :
- La règle est dans le code (`contractor-store.ts`, `document-store.ts`), comme l'écriture du dossier, pas dans une migration : les politiques de la base laissent le manager lire ces tables, et la paie s'en sert pour lui (le blocage d'un versement dans Paie › Quinzaine, `payoutBlock`). Les retirer casserait ces lectures.
- Même code que l'écriture, `contractor_profile_forbidden`, avec un message de lecture : pas de code nouveau pour un même refus.
- Un autre chatteur garde `team_member_not_found` : il ne voit pas le membre.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- intégration (en CI, Docker absent ici) : `payroll-contractors` (le manager reçoit 403 sur le dossier de Théo et lit le sien), `payroll-documents` (le manager reçoit 403 sur la pièce de Kofi, le prestataire et le propriétaire la lisent).
