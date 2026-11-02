# CR-02 Accès de la créatrice : invitation, son compte en lecture, rien de l'équipe
Statut : todo (ADR 0042 § 1 et § 2, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0042)
Dépend de : CR-01, ADR 0042, EQ-11
Branche : task/cr-02-creator-access

## Objectif
La créatrice se connecte par une invitation et voit tout son compte (ventes, fans, conversations en lecture), jamais rien de l'équipe, et la base le garantit.

## Contexte à lire
`docs/adr/0042-creator-space.md` (§ 1, § 2, § 8), ADR 0023 (§ Données et RLS), ADR 0024, ADR 0025, `docs/architecture/threat-model.md`, le module `team` (vue « qui est en poste »), les liens d'invitation existants (`packages/contracts/src/invitation-links.ts`).

## À faire
- [ ] Invitation de la créatrice par le propriétaire depuis Créatrices : lien à usage unique, 72 h, rôle `creator` lié à sa fiche ; réutiliser le mécanisme d'invitation existant.
- [ ] Rail de la créatrice (ADR 0042 § 8) : Aujourd'hui · Agenda · Ventes · Contenu · Moi, chaque onglet n'apparaissant qu'avec son écran (ADR 0024).
- [ ] Lectures ouvertes au rôle `creator`, bornées à sa créatrice : fans (pseudo, dépenses, notes), conversations en lecture seule, qui est en poste (nom affiché et créneau). Aucune route d'écriture vers un fan.
- [ ] Fermetures prouvées : `team_members`, relevés, factures, avoirs, versements, dossiers, retours de chatting (CR-10) restent illisibles pour elle.
- [ ] Journal : chaque ouverture de conversation par la créatrice, comme pour un chatteur.
- [ ] Moi : profil, préférences de notifications (CR-01), déconnexion de ses appareils.
- [ ] Base (propriétaire de `packages/db`) : les lectures de la créatrice posent son rôle et son `creator_id`, lu côté serveur dans `user.creator_ids`, jamais dans la requête ; une politique RLS **restrictive** refuse INSERT, UPDATE et DELETE au rôle `creator` sur `conversations`, `messages`, `fans` et `media_descriptions` ; ses trois écritures permises (description d'un de ses médias, légende d'une de ses publications, retrait d'une publication prévue) ont chacune leur politique (ADR 0042 § 2).
- [ ] Restent fermés : brouillons non envoyés, verdicts des gardes, `llm_calls` et prompts, notes de supervision, auteur d'un message envoyé (ADR 0021) ; elle voit le message, jamais qui l'a écrit.
- [ ] L'onglet Persona qu'elle a aujourd'hui passe dans Moi (ADR 0042 § 8).

## Critères d'acceptation
- Tests d'intégration RLS (Postgres) : une créatrice lit ses fans et ses conversations, jamais ceux d'une autre ; elle ne lit aucune ligne d'équipe ni de paie, ni brouillon, verdict, appel au modèle ou auteur d'envoi ; toute écriture sur `conversations`, `messages`, `fans` et `media_descriptions` est refusée hors de ses trois écritures permises.
- Le lien d'invitation expiré ou déjà servi est refusé.
- Finition : captures Nuit et Jour, téléphone et bureau, mouvement réduit.

## Hors périmètre
Gains et ventes (CR-04), agenda (CR-05), contenu (CR-06).

## Notes de session
