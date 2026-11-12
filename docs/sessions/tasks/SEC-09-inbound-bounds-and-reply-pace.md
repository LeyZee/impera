# SEC-09 Message de fan borné, rythme ralenti passé 60 réponses dans l'heure
Statut : done
Phase : exploitation
Dépend de : SEC-07
Branche : claude/project-thread-bfbfaz (fil « Corriger les failles de l'audit sécurité »)

## Objectif (1 phrase)

Tenir la promesse de `security.md` § 4 (un plafond par conversation et par heure) sans jamais couper une conversation, et borner ce qu'un message de fan fait entrer.

## Contexte à lire (fichiers précis)

- `docs/conventions/security.md` § 4, `docs/architecture/message-flow.md` § 1.
- `apps/api/src/modules/conversations/domain/rules.ts`, `application/commands.ts` (`ingestMessage`).

## À faire (liste vérifiable)

- [x] Jusqu'à 60 réponses à un fan dans l'heure : rythme habituel. Au-delà : une réponse toutes les 3 minutes, comptées depuis sa dernière réponse.
- [x] Un message de fan garde 4 000 caractères et 20 médias ; le reste est coupé, le message est pris.
- [x] Docs : `security.md` § 4, `message-flow.md` § 1.

## Critères d'acceptation (tests, commandes, comportements observables)

- `rules.test.ts` : `respondAt` (59, 60, 80 réponses ; dernière réponse proche ou lointaine) et `boundFanText` (coupe sans casser un caractère).
- `conversations.integration.test.ts` : avec 60 réponses dans l'heure, le job `conversation.respond` part 3 minutes après la dernière ; une heure plus tard, 45 s ; un message de 9 000 caractères et 25 médias est pris, coupé.
- `pnpm check`, `pnpm test` et la CI verts.

## Hors périmètre

- Un plafond de dépense par fan en euros : le budget du jour reste global (ADR du budget).
- Le réglage de ces valeurs depuis le CRM : des constantes pour l'instant.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Valeurs choisies par Charles le 11/11 (carte « 60 réponses/heure, puis ralentir ») ; 20 par heure refusé : la conversation doit continuer, une vente peut en dépendre.
- Une « réponse » est un brouillon écrit par l'agent dans la conversation, quel que soit son sort : c'est ce qui coûte un appel de modèle.
- Le rythme ralenti part de sa dernière réponse et non du dernier message du fan : sinon un fan qui écrit sans arrêt repousserait sa réponse indéfiniment.
- Les messages sortants lus sur la plateforme ne sont pas coupés : ils viennent de l'équipe.

## Résultat

Un fan ne peut plus faire écrire plus de 60 réponses par heure au rythme habituel ni faire entrer un texte sans fin dans les prompts, et aucune conversation n'est coupée.
