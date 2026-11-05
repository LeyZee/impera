# 2026-11-05 · PRO-21 : le Playground joue la persona d'une créatrice, version au choix

- Fiche : recette du 05/11, PRO-21 (proprietaire.md).
- Fait :
  - `persona.versions.version(creatorId, versionId)` lit une version, active ou pas, sous sa RLS ;
  - `POST /v1/playground/persona` choisit la persona jouée : la fictive, ou une version d'une créatrice. La conversation recommence, les notes suivantes vont à elle, l'état dit `persona.played` ; 404 `playground_persona_not_found` pour une version qui n'est pas la sienne ;
  - Entraîner › Playground, colonne « Mise en situation », gagne « Elle » avant « Le fan » : la persona (fictive ou une créatrice) et sa version, la version en vigueur marquée. Une version pas encore active montre « Activer cette version », avec le mot de passe redemandé après 10 minutes, comme dans Créatrices ;
  - l'en-tête dit « Persona : Mia · v0.0.3 » au lieu de « Persona fictive » quand une créatrice est jouée.
- Tests : `persona-versions.integration.test.ts`, `playground-service.test.ts`, `routes.test.ts` (playground), `PersonaPicker.test.tsx`.
- Découvertes : les corrections du playground servent d'exemples de voix à toutes les créatrices, quelle que soit la persona jouée (`voiceExamples(records)` ne filtre pas par créatrice). À trancher avant d'entraîner plusieurs créatrices.
