# 2026-11-06 — ADR 0076 : la revue de l'équipe importée (part Bilan)

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, après « ok 0076 », « ok prestataire-proprio » et « ok créatrices-liste-manager » de Charles (06/11, 18 h 07–18 h 10)

## Fait

- Contrats (`packages/contracts/src/sales-feed-team.ts`) : la revue, ses lignes, ses propositions de lien, les actions par visiteur, les modèles nommés et l'écart avec les créatrices du membre, le retrait, les compteurs, le lot de liens avec ses refus par ligne, l'écart (« écarté »). `PlatformChatter` gagne `email` et `role` (lus par l'adaptateur Reveal).
- Domaine (`connectors/domain/team-import.ts`) : l'ordre des propositions du § 1, les droits du § 2 et du § 4, la lecture anormale du § 5, la revue construite à partir de la base et de la liste vivante.
- Migration 0135 (attribuée 0132, renumérotée après la fusion de 0134 sur `main`) : `sales_feed_chatter_reviews` (décision, `removedAt` lu, absent depuis, `isBot` lu), `sales_feed_team_readings` (dernière lecture, crue ou non), politiques restrictives « pas son propre lien » sur `sales_feed_chatters`, et `manager_invite` sur `team_members`, `member_roles`, `member_commission_rates` (chatteur créé dans la même transaction, barème du propriétaire en vigueur).
- Base (`infra/db/team-import-store.ts`) : tout passe par `withMember` ; le lien du propriétaire (`PUT …/chatters/:id`) aussi. L'adaptateur `invitationChatterLinks` pour le port d'invitation d'Équipe (#624).
- Routes : `GET …/team`, `GET …/team/counts`, `POST …/team/links`, `PUT …/team/:platformChatterId/dismissal` (propriétaire et manager actif ; la base décide).
- Tests : domaine (unitaires), routes contre la liste remplacée de FakeReveal, garde contre soi-même dans la base, retrait et lecture anormale (`sales-feed-team.integration.test.ts`).
- Bac à sable (après la fusion de #616) : `/__/reveal/chatters` change l'équipe que FakeReveal liste (retrait, absence, retour, nouveau compte, liste vide) ; ligne au guide `docs/recette/bac-a-sable.md`.
- Revue d'Extension : un prestataire jamais relié à l'agent, actions selon le lien de la ligne, 403 avant toute lecture, 503 si la liste est illisible, première lecture vide non crue, `role` nul accepté ; `teamRemovals` pour Équipe.
- Glossaire : équipe importée, proposition de lien, compte écarté, retrait de la plateforme, lecture anormale.

## Reste

- La route d'invitation (`POST …/team/:platformChatterId/invitation`, `recentLogin`) après la fusion de #624.
- Une lecture périodique de la liste : aujourd'hui elle est relue à l'ouverture de la revue et de Réglages › Flux de ventes, donc un retrait n'apparaît qu'à la prochaine ouverture.
- Le compte du membre « bot » de la session capturée n'est pas encore connu par son `chatterId` (ADR 0050 § 5) : un compte nommé « bot » est proposé décoché.

## Découvertes

- Un `SELECT … FOR UPDATE` passe par la politique UPDATE : sous une politique restrictive, il cache la ligne au lieu de la verrouiller. Le lien d'un manager vers lui-même lu ainsi semblait absent et son refus devenait un faux succès. On verrouille par clé (verrou consultatif), puis on lit simplement.
- Une politique qui lit sa propre table fait refuser chaque écriture par Postgres (récursion infinie), même celles du propriétaire.
