# EQ-20 Inviter un chatteur depuis Reveal : la part d'Équipe de l'ADR 0076
Statut : in_progress (ADR 0076 acceptée par Charles le 06/11/2026 : « ok 0076 » 18 h 07, « ok prestataire-proprio » et « ok créatrices-liste-manager » 18 h 10)
Phase : équipe (ADR 0023, ADR 0024, ADR 0076)
Dépend de : la route des propositions de lien, la migration (politiques d'équipe du § 3, garde du § 4) et ce que la lecture a vu (§ 5), par Bilan ; l'écran, par Extension
Branche : claude/project-thread-cohhca

## Objectif
Un compte Reveal que rien ne relie encore à un membre s'invite depuis sa proposition de lien, par le propriétaire ou un manager actif, en une seule transaction qui crée le membre et pose son lien. Le manager reste dans les bornes que Charles a fixées : un chatteur, un barème du propriétaire, des créatrices de sa liste.

## Contexte à lire
ADR 0076 (§ 3, § 4, § 5, § 10), ADR 0024 § Rôles, ADR 0050 § 5, `apps/api/src/modules/team/README.md`, `apps/api/src/invitation-links.ts`.

## À faire
- [x] Bornes du manager dans le domaine (`assertInviteFits`) : rôle `chatter`, préréglage en vigueur aujourd'hui sans part du net, créatrices de sa propre liste ; le propriétaire garde tous ses choix ; un chatteur n'invite personne.
- [x] Invitation dans une transaction (`invites(links).fromPlatform`) : bornes, verrou du compte, membre créé comme par `POST /team/members`, lien posé par `connectors` (port `PlatformChatterLinks`), audit `team_member.invite` avec l'identifiant de la plateforme ; redemandée pour le même compte, elle rend le membre déjà invité.
- [x] Lien d'invitation pour un manager actif : `invitation` d'un chatteur sans mot de passe seulement ; `reset` au propriétaire ; 409 `password_chosen_conflict`. Une invitation ne remplace jamais un mot de passe déjà choisi (`usable`).
- [x] Brancher sur `connectors` : `invitationChatterLinks` de Bilan (#626) donne `lockLink` et `link`, essayés de bout en bout.
- [ ] La route d'invitation, avec `recentLogin` : petite PR de Bilan après celle-ci (`team.invites(connectors.invitationChatterLinks).fromPlatform`).
- [x] Tests RLS sur la migration 0135 : « un manager hors de ses bornes » (§ 3 : rôle manager, son propre compte, un compte déjà créé, taux au-dessus du préréglage, part du net, ligne de rôle manager, chacun refusé par la base en 42501), « un manager contre lui-même » (§ 4 : jamais invité sur son propre compte Reveal ; les écritures directes sont dans `sales-feed-team` de Bilan), et l'invitation d'un manager dans ses bornes, de bout en bout.
- [ ] Afficher l'alerte de retrait (§ 5) : pastille sur sa ligne d'Équipe › Membres et ligne ambre sur sa fiche, à partir de `connectors.teamRemovals` (#626) ; PR suivante, avec captures.

## Critères d'acceptation
- Tests : bornes du domaine ; invitation du propriétaire, redemandée, compte déjà relié (membre ou agent), e-mail pris ; refus du manager avant toute écriture ; lien d'un manager (chatteur, `reset`, autre manager, mot de passe choisi, chatteur, manager suspendu) ; invitation qui ne remplace pas un mot de passe.
- Écrans de l'alerte vus par Charles (Nuit et Jour, ordinateur et téléphone) avant fusion.
