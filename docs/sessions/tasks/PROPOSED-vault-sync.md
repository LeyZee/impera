# Coffre Reveal : synchroniser dossiers et médias dans l'ordre de Reveal
Statut : proposed (ID à donner ; ADR 0099 temps 1 ; propriétaire proposé : Bilan, modules `connectors`, `media`, `packages/db`, worker)
Phase : 6
Dépend de : P2-02 (`listVaultMedia`), ADR 0030, ADR 0099
Branche : task/<id>-vault-sync

## Objectif
Le job `media.sync` reflète le coffre Reveal de chaque créatrice dans la médiathèque, dossiers compris, dans l'ordre d'upload de Reveal, sans télécharger aucun fichier.

## Contexte à lire
ADR 0030 (§ 1, § 2), ADR 0099 (§ 2, § 3, § 4, § 7), ADR 0071 (créatrice archivée), ADR 0089 (vignettes après archivage), `docs/reference/reveal-api-observed.md` (`vault.folders`, `vault.medias`), `docs/reference/fake-reveal.md`, `packages/db/src/schema/media.ts`, `PROPOSED-media-library.md` (qu'elle découpe : cette fiche en prend la partie synchronisation).

## À faire
- [ ] Migration (numéro à demander au coordinateur) : `media_platform_refs` selon ADR 0030 § 1 (`creator_id`, FORCE RLS, unique `(platform_account_id, platform_media_id)`, `media_asset_id` vide possible, `folder_ref`, `folder_name`, `last_synced_at`, `removed_at`) plus `platform_created_at` et `folder_position` (ADR 0099 § 3) ; `platform` ajouté à `DESCRIPTION_AUTHORS`.
- [ ] Job `media.sync` rejouable, par compte : lit les dossiers puis les pages de chaque dossier **l'une après l'autre** ; crée ou met à jour les liaisons par `platform_media_id` ; marque `removed_at` sans rien supprimer ; un média changé de dossier garde ses descriptions.
- [ ] Description fournie par Reveal : reprise en ligne `media_descriptions` d'auteur `platform`, jamais validée, jamais protectrice : elle cède sa place à `sense` comme une description non validée (remarque Médias sur #709, point 1).
- [ ] Moment Jour ou Nuit lu dans le nom du dossier, qui fait foi ; la lecture de la lumière par la vision (SC-04 c6) n'est qu'un contrôle en ambre.
- [ ] Une créatrice archivée (ADR 0071) n'est pas synchronisée ; une vignette effacée par l'ADR 0089 n'est jamais refaite (`thumbnailed_at` reste posé).
- [ ] Route de lecture de la médiathèque par dossier, triée par `platform_created_at`, `folder_position`, puis identifiant Reveal ; au harnais d'isolation.

## Critères d'acceptation
- Test contre `FakeReveal` : un dossier sur plusieurs pages, avec deux uploads à la même seconde, sort dans l'ordre de Reveal après une puis deux synchronisations ; l'ordre attendu est fixé explicitement dans le test (FakeReveal trie aujourd'hui du plus récent au plus ancien, remarque Médias).
- Une resynchronisation n'écrit rien de nouveau ; un média retiré garde ses descriptions ; un média déplacé change de dossier sans perdre sa description.
- Une créatrice archivée n'est pas lue ; test RLS sur la table nouvelle.
- Vérification sur le PC de Charles, en lecture seule : l'ordre du CRM est celui de l'écran du coffre, dossier par dossier (tour à demander au coordinateur).

## Hors périmètre
Téléchargement des octets et description par la vision (fiche `PROPOSED-vault-fetch-media.md`), écran (fiche `PROPOSED-vault-screen.md`), import des scripts (fiche `PROPOSED-vault-import-scripts.md`).

## Notes de session
