# 2026-10-27 — EQ-10, serveur des liens d’invitation (Bilan) — done

Fait : migration 0018 `invitation_links`, routes `POST /v1/team/members/:memberId/invitation-link`, `POST /v1/invitation-links/inspect` et `POST /v1/invitation-links/redeem` selon le contrat de #172, limiteurs par route qui échouent fermés, `audit_log`, `meOf` partagé avec `/v1/me`, `liveInvitationLinksUnscoped` pour `invitationExpiresAt` de la liste de l’équipe (branché ensuite par le fil Équipe), documentation (`data-model.md`, `security.md`, fiche EQ-10).

Pas fait : les écrans `/bienvenue` et `/nouveau-mot-de-passe` (fil Équipe), Aujourd’hui.

Décisions : le mot de passe hors bornes répond `password_invalid` avec sa raison et laisse le lien intact (le schéma de la route lit une chaîne simple, bornée à quatre fois le maximum). La raison `refused` n’est produite par rien aujourd’hui : Better Auth n’a pas de liste de mots de passe refusés dans notre configuration.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, tests d’intégration de l’API (Postgres 16 local).
