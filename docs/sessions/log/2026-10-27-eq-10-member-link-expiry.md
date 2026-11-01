# 2026-10-27 — EQ-10 : fin du lien d'invitation dans la fiche d'un membre — done
Fait : `invitationExpiresAt` de `GET /v1/team/members` et `GET /v1/team/members/:memberId` vient du lien en cours du membre (ni utilisé ni remplacé, expiré ou non), par un port du module `team` (`InvitationLinkDirectory`) que le composition root adosse à `liveInvitationLinksUnscoped` (#184). Le service l'ajoute après la lecture de la fiche ; le module ne lit jamais la table des liens.
Pas fait : rien de cette fiche ; les pages « Bienvenue » et « Nouveau mot de passe » suivent dans leur propre PR.
Décisions : la date reste affichée une fois passée, pour que l'écran dise « Lien expiré » au lieu de proposer un premier lien ; `null` quand aucun lien n'est en cours (jamais créé, ou déjà utilisé). Un lien de nouveau mot de passe se voit aussi : sinon le propriétaire en crée un second qui annule le premier (Extension, sur la remarque de Bilan ; l'écran #180 l'affiche déjà).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, `team-members.integration.test.ts` (13 cas) et `invitation-links.integration.test.ts` verts sur Postgres 16 local.
