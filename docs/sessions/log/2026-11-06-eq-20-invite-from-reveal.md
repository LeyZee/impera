# 2026-11-06 — EQ-20 : la part d'Équipe de l'ADR 0076, prête avant la route de Bilan

Fait :
- Relecture de l'ADR 0076 (#617) : dix points rendus et intégrés par Bilan avant « ok 0076 » (ADR 0024 dans l'en-tête, bornes tenues par la base, créatrices de la liste du manager, lien `invitation`, garde du § 4 sur l'ancienne et la nouvelle ligne, idempotence, alerte comme un état). Les deux questions d'argent et d'accès tranchées par Charles : « ok prestataire-proprio », « ok créatrices-liste-manager ».
- `team` :
  - `assertInviteFits` (domaine) : le propriétaire garde tous ses choix ; un manager actif invite un chatteur, à un préréglage, sans part du net, avec des créatrices de sa liste ; 403 `role_forbidden` avec `details.bound`.
  - `createDrizzleTeamInvites` et `invites(links).fromPlatform` : une transaction sous `withMember` (bornes, verrou du compte, membre, lien, audit `team_member.invite`) ; `insertMember` partagé avec `create`.
  - le service prend le préréglage en vigueur aujourd'hui : une ancienne ligne d'un nom, plus haute, n'est pas proposée, donc introuvable.
- Lien d'invitation (`invitation-links.ts`) : un manager actif obtient le lien `invitation` d'un chatteur sans mot de passe ; qui demande est vérifié avant le membre, pour ne rien dire de son existence. Une invitation ne remplace jamais un mot de passe déjà choisi (`usable`) : avant, le rachat d'un lien d'invitation écrasait le mot de passe existant. Le bouton de la fiche n'envoyait déjà que `reset` dans ce cas.
- Contrats : `password_chosen_conflict` et `role_forbidden` dans `INVITATION_LINK_ERROR_CODES`, et la phrase du manager sur la route.
- Tests : domaine (bornes), service (préréglage en vigueur, e-mail, compte), intégration `team-invite-from-platform` (6) et `invitation-links` (2 nouveaux).

Reste : brancher sur la route et la migration de Bilan (les politiques d'insertion restent au scope `owner` d'ici là), les tests RLS du § 3 et du § 4, l'affichage de l'alerte de retrait.

Découvertes :
- « Suggestion » désigne déjà dans le glossaire ce que l'agence propose à l'agenda d'une créatrice (ADR 0042) ; l'ADR 0076 l'emploie pour les comptes Reveal. Signalé à Bilan.
- EXT-10 (Aujourd'hui du chatteur à l'heure de l'appareil, Planning à celle du profil) : confié au fil de recette du lot Équipe.
