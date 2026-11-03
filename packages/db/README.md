# @impera/db

Schéma Drizzle (`src/schema/`), migrations SQL relues (`migrations/`), client et pool, `withTenant` / `withMember` / `withTenantMember` / `withCreatorAccount` / `withAdmin` (RLS, ADR 0005, 0023 et 0042) et `enterCreator` (passer d'une créatrice à l'autre dans une même transaction, ADR 0031), chiffrement des secrets (`crypto.ts`, AES-256-GCM, clés versionnées, contexte lié), helpers de tests d'intégration (`src/test/`).

Commandes : `pnpm db:generate` (depuis le schéma), `pnpm db:migrate` (avec `DATABASE_ADMIN_URL`), `pnpm db:studio` (dev).

## Rôles

- `nirvana_admin` possède les tables et lance les migrations. En production : `NOSUPERUSER BYPASSRLS` (les jobs `*Unscoped` passent par `withAdmin`). Le test d'intégration le vérifie.
- `nirvana_app` : `NOSUPERUSER NOBYPASSRLS`, droits DML seulement (accordés par la migration). Toute requête de l'application passe par `withTenant(db, creatorId, fn)` ; hors de lui, les tables à `creator_id` renvoient zéro ligne.

## Le compte de la créatrice (CR-02, ADR 0042 § 2)

- `withCreatorAccount(db, userId, fn)` est la seule porte des routes de son espace. Dans la transaction, il lit `user.role` et l'unique créatrice liée au compte, jamais d'après l'appelant, puis pose en `SET LOCAL` `app.user_id`, `app.account_role` (`creator`) et `app.creator_id`. Tout autre compte lève `NotACreatorAccount`.
- La base tient un compte `creator` à exactement une créatrice (`user_creator_link_check`).
- Des politiques **restrictives** lisent `app.account_role` : aucune politique permissive ne les rouvre. `creatorReadsOnly()` refuse ses écritures sur `conversations`, `messages`, `fans`, `fan_facts`, `fan_summaries`, `media_descriptions`, `media_assets`, `media_sends` et `platform_accounts` (elle les lit) ; `closedToCreator()` lui ferme `drafts` (traces des gardes comprises), `llm_calls`, `calibration_ratings`, `conversation_events` (l'auteur d'un envoi y figure), `blind_tests`, `notifications`, `kill_switches`, `custom_alerts`, `alert_seen` et `system_alert_settings`. `closedToCreator()` ferme aussi `platform_sales`, qu'elle lit par la vue `creator_sales` (CRM-04 lot d, migration 0085) : ses lignes et leurs montants, jamais le chatteur ni le fan chez la plateforme, l'identifiant de la fiche du fan seulement quand la fiche est de sa créatrice. La vue appartient au rôle des migrations, qui contourne la RLS : son propre filtre (sa créatrice et `app.account_role = 'creator'`) est ce qui tient, et toute autre transaction n'en lit rien. Elle repose sur l'attribut `BYPASSRLS` de `nirvana_admin` : `platform_sales` force sa RLS (0065), et sans lui `creator_closed` viderait la vue sans bruit. `hiddenFromCreator()` lui cache `domain_events` (`sale_detected` dit qui a vendu) sans l'empêcher d'y ajouter l'événement d'une de ses écritures. `agencyOnly()` met la RLS, avec une seule politique permissive pour tout autre chemin, sur les tables d'agence du registre où figurent un chatteur, un fan ou un membre : `platform_sales_quarantine`, `sales_feed_chatters`, `sales_feed_checks`. Exception nommée : `persona_versions` (elle écrit sa persona, Moi › Persona, ADR 0042 § 8, par la porte de l'agence : son enregistrement et son activation écrivent aussi le journal d'audit et les événements). Une restrictive ne se rouvre jamais par une permissive : chacune de ses trois écritures permises (CR-06) **remplacera** la restrictive de sa table par une restrictive taillée pour elle (`using (… is distinct from 'creator' or <l'écriture permise>)`), avec un `GRANT UPDATE (<colonne>)` limité à la colonne qu'elle change. Toute table qui porte `tenant_isolation` a une décision pour la créatrice (lecture seule, fermée ou exception nommée) : `creator-account-rls.integration.test.ts` échoue sur une table nouvelle qui n'en a pas.
- « Qui est en poste » (lot b2, migration 0088) : la vue `creator_on_duty` (`security_barrier`, appartenant au rôle des migrations, qui lit `shifts` et `team_members` malgré leur RLS forcée grâce à l'attribut `BYPASSRLS` de `nirvana_admin`) rend le nom affiché du membre et le créneau de chaque shift non annulé d'un membre actif sur ses comptes, jamais `team_members`. Elle ne s'ouvre qu'avec `app.account_role = 'creator'` et son `app.creator_id` (vide pour l'agence et les jobs) ; `nirvana_app` la lit et n'y écrit rien.
- `withMember` pose aussi `app.account_role` avec le rôle lu en base : une créatrice qui passerait par lui reste une créatrice. Les jobs (`withAdmin`, `withTenant`) ne le posent pas et ne sont pas concernés.
- L'auteur d'un message est une colonne : la RLS ne le cache pas. La lecture de la créatrice ne le sélectionne pas et son contrat de réponse est `strict` (CR-02 lot b).

## Écrire une migration

1. Modifier `src/schema/`, puis `pnpm db:generate --name <sujet>`.
2. Relire le SQL et compléter à la main dans le même fichier : `FORCE ROW LEVEL SECURITY` pour toute nouvelle table à `creator_id` (la politique vient de `tenantPolicy()` dans le schéma), `GRANT` à `nirvana_app`, triggers. La fin de `0000_core.sql` sert de modèle.
3. Une migration appliquée ne se modifie jamais (`hygiene.md`) ; expand/contract pour les colonnes (`operations.md`).

### Numéros de migration entre fils

- Bilan attribue le numéro. La PR l'annonce à son ouverture, et c'est l'ordre de fusion qui fait foi.
- `drizzle-kit generate` nomme le fichier d'après l'index du journal et réécrit le snapshot de ce numéro. Il faut donc :
  - renommer le SQL et le snapshot au numéro attribué ;
  - restaurer l'ancien snapshot (`git checkout`) ;
  - corriger le `tag` du journal.
- Quand une autre migration fusionne avant la sienne, la seconde PR se remet sur `main` et **régénère** :
  - supprimer sa migration, son snapshot et son entrée de journal ;
  - relancer `pnpm db:generate` ;
  - compléter de nouveau le SQL à la main si besoin, puis renommer comme ci-dessus.
- Un numéro plus petit que le plus grand déjà dans `main` ne peut plus servir : `check-drift` lirait l'ancien snapshot. La PR prend alors le prochain numéro libre, et l'ancien reste un trou (0086 et 0087 en sont, 03/11).
- On n'édite jamais le journal à la main pour réordonner. `check-drift` compare au plus grand snapshot par nom, et Drizzle saute en silence une entrée dont le `when` est plus ancien que la dernière appliquée.

## Tests d'intégration

`pnpm --filter @impera/db test:integration` démarre un Postgres 16 avec Testcontainers (Docker requis), crée les deux rôles comme en production, puis une base migrée par fichier de test (`createTestDb`). Sans Docker, `IMPERA_TEST_PG_URL` donne l'URL superutilisateur d'un Postgres 16 jetable à utiliser à la place.

## Écarts avec `data-model.md`

- L'index partiel des faits actifs filtre `superseded_by is null` seulement : `now()` n'est pas permis dans un prédicat d'index ; l'expiration se filtre à la requête.
- Les tables Better Auth (`src/schema/auth.ts`) sont écrites d'après son schéma de base ; P0-07a les compare à la sortie de sa CLI et migre si elle diffère.
