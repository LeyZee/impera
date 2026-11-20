# Module `media`

**Rôle.** Catalogue de médias, descriptions au vocabulaire Impera (hérité d'OnlyScript), extraction de frames et transcription (ffmpeg, fourni par l'image Docker, voir `operations.md`), historique d'envoi par fan.

**Peut dépendre de.** packages/llm (rôle sense)

**Règles propres.** Propriétaire de `media_assets`, `media_descriptions`, `media_sends`, `vault_import_choices` et `vault_describe_requests` ; de `media_platform_refs` (à `connectors`), n'écrit que la liaison et les essais (`media_asset_id`, `description_failures`). Lecture exposée : `createDrizzleDescriptionReader` (`of(creatorId, ids)`), la dernière description gardée de chaque média (sa `factualDescription`), sous RLS ; le composition root la branche sur le port `MediaDescriptions` de `conversations` pour le fil de Suivi (SUIVI-26).

## Ce qu'elle dépose, décrit en détail (ADR 0083)

- `application/describe-drop.ts` décrit une photo ou une vidéo de ses dépôts, **seule** : un appel par média (`describeDrop` de la passerelle, prompt `sense/creator-drop.md`), avec le contexte que le module `content-drops` écrit. Une vidéo de plus de 20 Mo n'est jamais lue en mémoire : ses images clés sont tirées du fichier sur disque (`createFfmpegFileTools`), avec sa transcription.
- `domain/drop-review.ts` lit la réponse, sans croire le modèle : un renvoi à un autre média (« à nouveau », « la même », « toujours »…, hors des paroles citées) fait redemander une fois, puis garde la description avec la raison `back_reference` ; une autre personne (`castMode` duo ou groupe, ou le drapeau `identifiable_third_party`) donne `not_alone`, elle tourne toujours seule ; un doute du modèle `unsure` ; tout autre drapeau `flagged`.
- `infra/drop-description-store.ts` écrit la ligne au rôle administrateur : `author` `sense`, `review_reasons`, ni validée ni utilisable avant la validation humaine (ADR 0030 § 3, ADR 0083 § 7). Une ligne par média et par version du prompt (`media_descriptions_drop_unique`) : un job rejoué n'écrit rien deux fois. Une correction humaine est une nouvelle ligne (`author` `human`). Qui valide une ligne, et quand, arrive avec l'écran de validation (lot c) : le propriétaire n'a pas de fiche d'équipe, la validation référencera donc son compte (`user`), ce qui demande d'amender l'ADR 0030 § 3.
- `detailed` (même magasin) donne la description détaillée la plus récente de chaque média demandé, celle de la vision ou une correction humaine : la synthèse d'un script envoyé (module `content-drops`, ADR 0083 § 6) la lit.

## Son coffre, lu le temps de la description (ADR 0113)

- **Le coffre au choix (ADR 0145 § 5, avenant du 17/11).** Rien du coffre n'entre dans le CRM sans un geste du propriétaire : une coche par dossier (racine comprise) ou par média (`vault_import_choices`, `schema.vaultImported` lit l'une puis l'autre). Rien n'est décrit sans sa demande : `POST …/vault/describe` répond d'abord le nombre et le coût estimé (`domain/vault-choice.ts`), puis, avec ce même nombre et ce même coût confirmés, écrit `vault_describe_requests` et met `media.describe_vault` en file, dans sa transaction ; une confirmation plus chère que ce qui reste du plafond IA du jour est refusée, rien demandé (422 `vault_describe_over_cap_unprocessable`). Une demande que le plafond arrête en cours reste « Description en cours » sur l'écran et repart seule une heure plus tard. Aucun job ne décrit le coffre de lui-même, et aucun interrupteur ne le fait en continu.
- `application/describe-vault.ts` est `media.describe_vault`, sur la file du compte : un lot (`VAULT_LOT`) des liaisons du coffre demandées, importées et sans fichier, dans l'ordre de `domain/vault.ts` (scripts importés actifs d'abord, ceux à qui il manque le moins de descriptions en premier, aperçus compris ; puis les autres scripts ; puis le coffre dans son ordre). Chaque fichier est lu par le port `VaultFileRead` (le `vaultFiles` de `connectors`, branché par le composition root) dans un dossier temporaire du job, effacé dans un `finally`, réussi ou non.
- Une empreinte déjà connue d'elle : la liaison rejoint ce média, sans appel de vision. Sinon : un flux MPEG-TS est recopié en MP4 (`remuxVaultStream`, seul endroit où ffmpeg ouvre `mpegts`), décrit comme un dépôt (`createDropDescriber`, même forme détaillée, ADR 0083), réduit à sa vignette par le port `picture` (celui de `content-drops`, même clé `thumbnail_key`), puis gardé né effacé (`infra/vault-describe-store.ts` : origine `vault`, `storage_key` vide, `erased_at` posé) avec la description `sense` et le texte de la plateforme (auteur `platform`, sans `detailed` : aucun lecteur ne le prend pour la description du moment), le tout dans une transaction.
- Un fichier qui ne se lit pas, ou que la vision rate `DESCRIPTION_TRIES` fois : `media_platform_refs.description_failures` au plafond, « À décrire par l'agence ». Une note vocale n'est jamais prise. Le budget du jour atteint : arrêt, le job se remet une heure plus tard. La synchronisation du coffre le remet aussi en file : il ne trouve que ce qui a été demandé.

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
