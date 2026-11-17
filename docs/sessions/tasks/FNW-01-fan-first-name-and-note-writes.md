# FNW-01 L'agent écrit le prénom du membre et le canevas de la note client
Statut : in_progress
Phase : exploitation
Dépend de : ADR 0117
Branche : claude/project-thread-vdeki0 (branche imposée par la session)

## Objectif
Appliquer l'ADR 0117 : ce que l'agent apprend du fan remonte dans le prénom du membre et dans les lignes du canevas de la note client de la plateforme, sans jamais effacer sans trace ce qu'un chatteur a écrit.

## Contexte à lire
ADR 0117, ADR 0018, ADR 0085, `docs/reference/reveal-connector-spec.md`, `docs/reference/reveal-api-observed.md`, `apps/api/src/modules/connectors/infra/reveal/note.ts`, `apps/api/src/modules/connectors/application/outbound-sender.ts`, module `fans`.

## À faire
- Lot 0 : ADR 0117, acceptée (« ok 0117 » du 16/11).
- Lot a (sans capture) : table des empreintes de lignes écrites par l'agent (migration, numéro donné au signal), job `connectors.sync_fan_platform_fields`, règles § 3 et § 4 dans un domaine pur testé, tests contre `FakeReveal`.
- Lot b (après la capture du prénom sur le compte fan test, avec l'accord écrit de Charles) : `setFanFirstName` et la capacité `fanFirstNameWrite`, règle § 2, signalement au chatteur, route observée dans `reveal-api-observed.md`.

## Résultat
- Lot 0 : ADR acceptée le 16/11.
