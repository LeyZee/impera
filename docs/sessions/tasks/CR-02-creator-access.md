# CR-02 Accès de la créatrice : invitation, son compte en lecture, rien de l'équipe
Statut : in_progress, lot a (base) et lot b1 (ses lectures) le 03/11/2026 ; restent Dashboard et Persona par sa porte, « qui est en poste », l'invitation et les écrans (ADR 0042 § 1 et § 2, acceptée par Charles le 02/11/2026)
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
- [ ] Base (propriétaire de `packages/db`) : le chemin de lecture de la créatrice pose deux réglages de transaction, `app.account_role`, déduit de `user.role` lu en base comme `withMember` déduit le scope et jamais d'après l'appelant, et `app.creator_id`, lu dans `user.creator_ids`, jamais dans la requête. Une contrainte en base veut qu'un compte `creator` porte exactement un `creator_id` (`role <> 'creator' or cardinality(creator_ids) = 1`), par une migration dont Bilan donne le numéro. Une politique RLS **restrictive** `FOR INSERT, UPDATE, DELETE`, écrite contre `current_setting('app.account_role', true) is distinct from 'creator'`, refuse ces écritures sur `conversations`, `messages`, `fans` et `media_descriptions` ; ses trois écritures permises (description d'un de ses médias, légende d'une de ses publications, retrait d'une publication prévue) ont chacune leur politique (ADR 0042 § 2).
- [ ] Restent fermés : brouillons non envoyés, verdicts des gardes, `llm_calls` et prompts, notes de supervision (des lignes : une politique `SELECT` restrictive les ferme) ; et l'auteur d'un message envoyé (ADR 0021), qui est une colonne et que la RLS ne cache pas : il se ferme par une lecture qui ne le sélectionne pas et par un contrat Zod `strict` de la réponse de la créatrice, sans champ auteur. Elle voit le message, jamais qui l'a écrit.
- [ ] L'onglet Persona qu'elle a aujourd'hui passe dans Moi (ADR 0042 § 8).

## Critères d'acceptation
- Tests d'intégration RLS (Postgres) : une créatrice lit ses fans et ses conversations, jamais ceux d'une autre ; elle ne lit aucune ligne d'équipe ni de paie, ni brouillon, verdict ou appel au modèle ; un compte `creator` sans `creator_id` ou avec deux est refusé par la base ; toute écriture sur `conversations`, `messages`, `fans` et `media_descriptions` est refusée hors de ses trois écritures permises.
- Auteur d'un envoi : test d'intégration par la route et par le contrat (la réponse ne porte aucun champ auteur, un champ de trop fait échouer le contrat `strict`).
- Le lien d'invitation expiré ou déjà servi est refusé.
- Finition : captures Nuit et Jour, téléphone et bureau, mouvement réduit.

## Hors périmètre
Gains et ventes (CR-04), agenda (CR-05), contenu (CR-06).

## Notes de session

### 03/11/2026, lot a (base, migration 0082)
- `withCreatorAccount(db, userId, fn)` dans `packages/db`, exportée par l'index : lit `user.role` et l'unique créatrice liée dans la transaction, pose `app.user_id`, `app.account_role` et `app.creator_id` en `SET LOCAL` ; tout autre compte lève `NotACreatorAccount`. Noms accordés avec Bilan et Équipe (CRM-04 lot d lit `app.account_role` et `app.creator_id`, migration 0081).
- `withMember` pose aussi `app.account_role` (demande de Bilan) : une créatrice passée par `withMember` ou `withTenantMember` reste une créatrice pour les politiques restrictives.
- Migration 0082 : `user_creator_link_check` (un compte `creator` porte exactement une créatrice) ; politiques restrictives `creator_no_insert`, `creator_no_update`, `creator_no_delete` sur `conversations`, `messages`, `fans`, `media_descriptions`, et `creator_closed` sur `drafts`, `llm_calls`, `calibration_ratings`, `conversation_events`.
- Tests d'intégration (`creator-account-rls`) : contrainte d'un seul lien, porte réservée au compte créatrice, ses lectures bornées à sa créatrice, lectures fermées, écritures refusées (insertion en erreur, mise à jour et suppression sans ligne), aucune ligne d'équipe, `withMember` et `withTenantMember` qui la gardent créatrice. Deux tests existants qui créaient un compte `creator` sans créatrice le lient à une créatrice.
- Relecture de Bilan (#460) : une politique restrictive ne se rouvre jamais par une permissive. Ses trois écritures permises (CR-06) **remplaceront** la restrictive de leur table (`creator_no_update` ou `creator_no_insert`) par une restrictive taillée, `using (current_setting('app.account_role', true) is distinct from 'creator' or <l'écriture permise>)`, avec un `GRANT UPDATE (<colonne>)` limité ; une permissive ajoutée n'ouvrirait rien.
- Classement : toute table à `tenant_isolation` a une décision dans `CREATOR_DECISIONS` (`creator-account-rls.integration.test.ts`). Lecture seule : conversations, messages, fans, fan_facts, fan_summaries, media_descriptions, media_assets, media_sends, platform_accounts. Fermées : drafts, conversation_events, llm_calls, calibration_ratings, blind_tests, notifications, kill_switches, custom_alerts, alert_seen, system_alert_settings. Exceptions : persona_versions (elle y écrit aujourd'hui par `withTenant` ; décision au lot b avec Moi › Persona, ADR 0042 § 8), domain_events et platform_sales (fermées au lot d de CRM-04, migration 0081). Une table nouvelle sans décision fait échouer le test. Limite notée par Bilan : le test ne lit que les tables dont la politique s'appelle `tenant_isolation` ; une table sous `tenantOrGlobalPolicy` (`global_read`) ou sous une politique propre d'équipe y échappe (les tables d'équipe restent fermées par `app.team_scope`, jamais posé pour elle). Le jour où une table « tenant ou globale » porte quelque chose de sensible, élargir le filtre à toute politique qui lit `app.creator_id`.
- Restent : ses trois écritures permises (avec CR-06) ; les routes existantes ouvertes à la créatrice (Dashboard, Persona) passent encore par `withTenant`, sans `app.account_role` : elles passent à `withCreatorAccount` au lot b, avec l'invitation, les lectures et la réponse `strict` sans auteur.

### 03/11/2026, lot b1 (ses lectures)
- Routes `/v1/creator-space` (rôle `creator` seul) par `withCreatorAccount` : `fans` (pseudo, ce qu'il a payé par devise, premier et dernier passage, sa conversation), `conversations/:id` (son fan et ses notes) et `conversations/:id/messages` (sens, texte, médias, prix, jamais l'auteur ni le brouillon). Contrats `strict` dans `packages/contracts/src/creator-space.ts`.
- Chaque ouverture d'une conversation est écrite dans `audit_log` (`conversation.open`, `details.by = 'creator'`), dans la transaction de la lecture.
- Ses notes (relecture de Bilan) : seulement ce que le fan a dit lui-même (`declared`), jamais la note d'un chatteur (`operator_note`, elle trahirait qu'on écrit à sa place), jamais une déduction du modèle (`inferred`), et jamais son profil d'achat (`commercial`) : Charles, 03/11 11h40, « elles n'ont pas besoin d'avoir les détails exacts ». Filtré en code (`creatorNotesOf`, test unitaire et d'intégration). Ce qu'un fan a payé est le prix TTC des messages débloqués, pas ses gains (`modelRevenue`, ADR 0054) : l'écran le nommera ainsi au lot c.
- Ses notes et les descriptions de médias passent par les modules `fans` et `media`, bornés à la créatrice que son compte nomme (lue par `withCreatorAccount`), jamais à une créatrice de la requête.
- Restent : lot b2 (Dashboard et Persona par sa porte, décision `persona_versions`, « qui est en poste » par une vue qui ne rend que le nom affiché et le créneau, ADR 0023) ; lot b3 (invitation, migration) ; lot c (écrans).

### Lot futur : les insights de sa base de fans (demande de Charles, 03/11 11h40)
- Ce qu'il veut : des chiffres agrégés sur sa base, « entre copines » (part de ses fans par tranche d'âge, par métier, ce genre de pourcentages), **jamais un détail par fan**.
- Garde-fous à tenir : agrégats seulement à partir des faits `declared` (ni `inferred`, ni `operator_note`, ni `commercial`) ; un pourcentage ne s'affiche qu'au-delà d'un seuil de fans par case, sinon « trop peu de fans » (pas de réidentification) ; calcul côté serveur, l'écran ne calcule rien.
- Où ça rentre : un lot après le lot c de CR-02, sur l'onglet Ventes › Fans. Le seuil et les tranches sont des choix de produit : une ADR courte les fixe avant le code.
