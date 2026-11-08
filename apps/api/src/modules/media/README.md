# Module `media`

**Rôle.** Catalogue de médias, descriptions au vocabulaire Impera (hérité d'OnlyScript), extraction de frames et transcription (ffmpeg, fourni par l'image Docker, voir `operations.md`), historique d'envoi par fan.

**Peut dépendre de.** packages/llm (rôle sense)

**Règles propres.** Propriétaire de `media_assets`, `media_descriptions`, `media_sends`. Lecture exposée : `createDrizzleDescriptionReader` (`of(creatorId, ids)`), la dernière description gardée de chaque média (sa `factualDescription`), sous RLS ; le composition root la branche sur le port `MediaDescriptions` de `conversations` pour le fil de Suivi (SUIVI-26).

## Ce qu'elle dépose, décrit en détail (ADR 0083)

- `application/describe-drop.ts` décrit une photo ou une vidéo de ses dépôts, **seule** : un appel par média (`describeDrop` de la passerelle, prompt `sense/creator-drop.md`), avec le contexte que le module `content-drops` écrit. Une vidéo de plus de 20 Mo n'est jamais lue en mémoire : ses images clés sont tirées du fichier sur disque (`createFfmpegFileTools`), avec sa transcription.
- `domain/drop-review.ts` lit la réponse, sans croire le modèle : un renvoi à un autre média (« à nouveau », « la même », « toujours »…, hors des paroles citées) fait redemander une fois, puis garde la description avec la raison `back_reference` ; une autre personne (`castMode` duo ou groupe, ou le drapeau `identifiable_third_party`) donne `not_alone`, elle tourne toujours seule ; un doute du modèle `unsure` ; tout autre drapeau `flagged`.
- `infra/drop-description-store.ts` écrit la ligne au rôle administrateur : `author` `sense`, `review_reasons`, ni validée ni utilisable avant la validation humaine (ADR 0030 § 3, ADR 0083 § 7). Une ligne par média et par version du prompt (`media_descriptions_sense_unique`) : un job rejoué n'écrit rien deux fois. Une correction humaine est une nouvelle ligne (`author` `human`). Qui valide une ligne, et quand, arrive avec l'écran de validation (lot c) : le propriétaire n'a pas de fiche d'équipe, la validation référencera donc son compte (`user`), ce qui demande d'amender l'ADR 0030 § 3.

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
