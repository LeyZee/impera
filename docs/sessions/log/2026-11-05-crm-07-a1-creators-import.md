# 2026-11-05 — CRM-07 lot a1 : importer les créatrices de Reveal après revue

Fait :
- `PlatformModel` porte le statut de la modèle (inconnu lu `other`) et sa photo (`https` seulement) ; l'adaptateur Reveal les lit de `/v1/models` ;
- `proposeImports` (`connectors/domain/model-import.ts`) : relier par le pseudo d'un compte, puis par le nom, sinon créer ; cochée d'avance si `validated` et active ;
- l'aperçu de Réglages › Ventes Reveal rend `candidates` et `dismissed` ;
- `POST /v1/settings/sales-feeds/:plateforme/import` : une transaction par ligne (créatrice, compte, lien, quarantaine libérée, audit), refus ligne par ligne, rejeu sans effet ;
- `PUT` et `DELETE …/models/:id/dismissal` ; migration 0112 (`sales_feed_model_dismissals` sous RLS forcée, `creators.avatar_key`) ;
- `FakeReveal` : `setModels` et `IMPORT_MODELS`, modèles inventées.

Pas fait (a2) : copie de la photo, signal du statut inconnu, alerte quand une modèle disparaît ou passe `banned`.

Décisions :
- l'import relit la liste de la plateforme et ne prend du client que les identifiants et les choix ;
- un verrou consultatif par modèle rend le double clic sans effet (le second trouve le lien) ;
- `linkModel` et l'import partagent `linkIn` : mêmes conflits, même libération de la quarantaine, même audit ;
- une modèle reliée à une créatrice existante réutilise son compte qui a ce pseudo, sinon lui en crée un ; un pseudo tenu par une autre créatrice est refusé (`handle_taken`) ;
- la nouvelle table donne au rôle applicatif SELECT, INSERT et DELETE, jamais UPDATE.

Découvertes :
- aucune.

Vérifié :
- `pnpm check` ;
- unitaire `model-import`, adaptateur contre FakeReveal (statuts, photo) ;
- intégration `sales-feed-import` (droits, proposition, écartées, import, liens, double clic, liste illisible), `sales-feed`, `sales-feed-check`, `sales-feed-auto-check`, `sales-totals`, `connection-state`, `agency-share-check`.
