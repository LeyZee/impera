# Ajouter un module

1. **README d'abord.** `apps/api/src/modules/<name>/README.md` : rôle en une phrase, ce dont il peut dépendre, tables possédées, jobs émis. Si tu ne peux pas écrire « peut dépendre de » sans cycle, le découpage est faux.
2. **Graphe.** Ajoute le module dans `docs/architecture/modules.md` (graphe et tableau) et dans `eslint.config.js` (élément `boundaries` + règles autorisées). Lance `pnpm lint` : il doit passer avec le module vide.
3. **Contrats.** Types et schémas Zod partagés dans `packages/contracts/src/<name>.ts` (identifiants typés, enums, DTO des routes). Exporte depuis `packages/contracts/src/index.ts`.
4. **Domaine.** `domain/` : types internes, règles pures, erreurs `DomainError`. Tests unitaires à côté. Aucun import d'infra.
5. **Ports.** Interfaces dont le module a besoin (repositories, gateways externes) dans `domain/ports.ts`.
6. **Application.** `application/` : commandes et requêtes (`verbNoun.ts`), handlers de jobs (`jobs/`). Chaque transition d'état écrit son événement dans la transaction.
7. **Infra.** `infra/db/` (schéma Drizzle dans `packages/db/src/schema/<name>.ts` + repositories), `infra/http/` (routes Fastify typées Zod), `infra/jobs/` (enregistrement Graphile). Migration générée puis relue.
8. **Index.** `index.ts` : `createXModule(deps: XDeps): XModule` qui construit le module et n'expose que ce qui est documenté dans le README. Si le domaine d'un module qui dépend du tien a besoin d'une de tes règles pures (types, fonctions sans I/O, constantes, erreurs), ajoute `pure.ts` à la racine (ADR 0051) : des réexportations de ton `domain/` seulement, rien d'écrit dedans ; ESLint le vérifie.
9. **Câblage.** `apps/api/src/composition-root.ts` : instancie le module, l'enregistre (routes, jobs).
10. **Tests.** Unit (domaine), intégration (repositories avec Testcontainers, au moins un test RLS), contrat si le module expose un port.
11. **Docs.** `data-model.md` si tables, `message-flow.md` si le chemin d'un message change, ADR `proposed` si décision structurante, glossaire si nouveau terme.
12. **Checklist de fin de session** (`docs/sessions/README.md`).
