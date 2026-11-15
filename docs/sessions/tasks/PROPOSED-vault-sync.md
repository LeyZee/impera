# Coffre Reveal : synchroniser dossiers et médias dans l'ordre de Reveal
Statut : review (ID à donner ; branche `task/vault-sync` ; ADR 0099 temps 1 ; propriétaire proposé : Bilan, modules `connectors`, `media`, `packages/db`, worker)
Phase : 6
Dépend de : P2-02 (`listVaultMedia`), ADR 0030, ADR 0099
Branche : task/<id>-vault-sync

## Objectif
Le job `connector.vault_sync` reflète le coffre Reveal de chaque créatrice dans la médiathèque, dossiers compris, dans l'ordre d'upload de Reveal, sans télécharger aucun fichier.

## Contexte à lire
ADR 0030 (§ 1, § 2), ADR 0099 (§ 2, § 3, § 4, § 7), ADR 0071 (créatrice archivée), ADR 0089 (vignettes après archivage), `docs/reference/reveal-api-observed.md` (`vault.folders`, `vault.medias`), `docs/reference/fake-reveal.md`, `packages/db/src/schema/media.ts`, `PROPOSED-media-library.md` (qu'elle découpe : cette fiche en prend la partie synchronisation).

## À faire
- [x] Migration 0200 (idx 143 après fusion de main ; l'ancienne 0173 ne peut plus servir, plus petite que 0193 ; numéro confirmé au signal) : `media_platform_refs` selon ADR 0030 § 1 (`creator_id`, FORCE RLS, unique `(platform_account_id, platform_media_id)`, `media_asset_id` vide possible, `folder_ref`, `folder_name`, `last_synced_at`, `removed_at`) plus `platform_created_at` et `folder_position` (ADR 0099 § 3), `folder_moment`, `platform_description` et la fourchette suggérée, et `platform_accounts.vault_synced_at` (heure de la dernière synchronisation réussie du compte) ; `platform` n'entre PAS dans `DESCRIPTION_AUTHORS` ici (voir Notes).
- [x] Job `connector.vault_sync` rejouable, par compte : lit les dossiers puis les pages de chaque dossier **l'une après l'autre** ; crée ou met à jour les liaisons par `platform_media_id` ; marque `removed_at` sans rien supprimer ; un média changé de dossier garde ses descriptions.
- [~] Description fournie par Reveal (gardée sur la liaison, voir Notes) : reprise en ligne `media_descriptions` d'auteur `platform`, jamais validée, jamais protectrice : elle cède sa place à `sense` comme une description non validée (remarque Médias sur #709, point 1).
- [x] Moment Jour ou Nuit lu dans le nom du dossier, qui fait foi ; la lecture de la lumière par la vision (SC-04 c6) n'est qu'un contrôle en ambre.
- [x] Une créatrice archivée (ADR 0071) n'est pas synchronisée ; une vignette effacée par l'ADR 0089 n'est jamais refaite (`thumbnailed_at` reste posé).
- [x] Route de lecture de la médiathèque par dossier, triée par `platform_created_at`, `folder_position`, puis identifiant Reveal ; au harnais d'isolation.

## Critères d'acceptation
- Test contre `FakeReveal` : un dossier sur plusieurs pages, avec deux uploads à la même seconde, sort dans l'ordre de Reveal après une puis deux synchronisations ; l'ordre attendu est fixé explicitement dans le test (FakeReveal trie aujourd'hui du plus récent au plus ancien, remarque Médias).
- Une resynchronisation sans changement n'écrit que l'heure de synchronisation du compte ; un média retiré garde ses descriptions ; un média déplacé change de dossier sans perdre sa description.
- Une créatrice archivée n'est pas lue ; test RLS sur la table nouvelle.
- Vérification sur le PC de Charles, en lecture seule : l'ordre du CRM est celui de l'écran du coffre, dossier par dossier (tour à demander au coordinateur).

## Hors périmètre
Téléchargement des octets et description par la vision (fiche `PROPOSED-vault-fetch-media.md`), écran (fiche `PROPOSED-vault-screen.md`), import des scripts (fiche `PROPOSED-vault-import-scripts.md`).

## Notes de session
- 14/11 (Bilan) : codé sur `task/vault-sync`.
  - Table `media_platform_refs` (migration 0200 provisoire), écrite par le job dans la transaction de la créatrice (`withTenant`) ; `nirvana_app` : SELECT, INSERT, UPDATE, jamais DELETE ; `impera_service` : SELECT seulement (consignes #716).
  - Job `connector.vault_sync` (`media.sync` dans l’ADR 0030 ; un job porte le préfixe du module qui l’exécute, glossaire mis à jour), sur la file du compte, après son relevé. **Aucune horloge** : seul le propriétaire le demande (`POST /v1/creators/:creatorId/vault/sync`), pour qu'aucune fusion ne lance une lecture réelle de Reveal sans accord. Une horloge (toutes les 6 h par exemple) se décidera après la première lecture réelle.
  - Lecture `GET /v1/creators/:creatorId/vault` : propriétaire et manager actif de sa liste (même règle que les chiffres de la créatrice), dossiers triés par numéro, racine à la fin, médias dans l'ordre de Reveal ; jamais d'adresse de fichier.
  - Ordre : `platform_created_at` du plus récent au plus ancien, comme FakeReveal et la capture le montrent (à vérifier sur le PC, dossier par dossier), puis `folder_position`, puis l'identifiant. `folder_position` est le rang de Reveal **entre uploads du même instant**, pas le rang dans tout le dossier : celui-ci bougerait à chaque nouvel upload et réécrirait tout le dossier à chaque synchronisation.
  - Description de Reveal : `media_descriptions` exige un `media_asset_id`, qui n'existe qu'une fois le fichier lu. Elle est donc gardée sur la liaison (`platform_description`), affichée comme texte brut, jamais validée ; la ligne d'auteur `platform` sera écrite par la fiche vault-fetch-media quand le média aura son fichier (ADR 0099 § 4 tenue à ce moment-là).
  - Fourchette suggérée : en centimes comme les autres prix de Reveal (supposé, à confirmer à la première lecture réelle), affichée seulement.
  - Ajout demandé par la coordination : `connectors.platformReads.scripts(platformAccountId)` (par le resolver, seulement si `capabilities.scripts`, sinon `platform_read_unavailable`), pour l'import des scripts par Médias.
  - Reste : la vérification sur le PC en lecture seule (tour à demander) ; l'horloge éventuelle.
