# 2026-11-07 — Route d'invitation depuis la revue de l'équipe Reveal (ADR 0076 § 3)

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur et Équipe, après la fusion de #624

## Fait

- `POST /v1/settings/sales-feeds/:platform/team/:platformChatterId/invitation` (connexion récente exigée), au contrat déjà écrit (`TeamImportInvitationBodySchema`, 201 avec le membre).
- `connectors` relit la liste en direct avant d'inviter : propriétaire ou manager actif d'abord (un chatteur est refusé sans appel à la plateforme), puis un compte listé et qui n'est pas celui d'un prestataire. Nouveaux codes : `sales_feed_external_invite_forbidden` (403), `sales_feed_chatter_unprocessable` (422) ; liste muette : 503 `sales_feed_list_unavailable`.
- Le membre et le lien sont faits par `team` (`invites(connectors.invitationChatterLinks).fromPlatform`), branché par la racine de composition (liaison tardive, `team` est câblé après `connectors`).
- Test d'intégration dans `sales-feed-team.integration.test.ts` : chatteur, prestataire, compte absent, liste muette, manager hors bornes, invitation du propriétaire rejouée (même membre), autre e-mail sur un compte relié (409).

## Reste

- L'écran (Extension) : le bouton « Inviter » de la ligne, avec le mot de passe redemandé.

## Découvertes

- Aucune.
