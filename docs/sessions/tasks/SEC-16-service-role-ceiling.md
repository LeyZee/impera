# SEC-16 Le rôle de service cesse de grandir : test de plafond par module
Statut : en cours (plafond fait ; la réduction suit, module par module)
Phase : exploitation
Dépend de : SEC-10, ADR 0087 (lots b et c)
Branche : claude/project-thread-bfbfaz (fil « Sécurité »)

## Objectif (1 phrase)

Empêcher que les accès à la base par le rôle de service, qui traverse les créatrices, augmentent, puis les faire baisser module par module avant l'arrivée d'une deuxième créatrice (demande de Charles, 20/11/2026).

## Contexte à lire (fichiers précis)

- `docs/adr/0087-*.md` § 5 et § Lots : le lot b (ce test) n'avait jamais été écrit, le lot c n'avait pas de pilote.
- `packages/db/src/client.ts` (`withAdmin`, `withTenant`, `withMember`), `packages/db/src/service-role.integration.test.ts` (ce que le rôle a le droit d'écrire).
- `apps/api/src/__tests__/service-role-ceiling.test.ts` et `service-role-ceiling.ts`.

## À faire (liste vérifiable)

- [x] Test de plafond : compte par module les appels `withAdmin(` et les requêtes envoyées directement sur la connexion de service, et exige exactement les nombres de `service-role-ceiling.ts`. Un ajout casse le test ; un retrait aussi, tant que le plafond n'est pas baissé dans la même PR.
- [x] Le total ne repasse jamais au-dessus de celui du 20/11/2026 (265).
- [ ] Plan de réduction écrit avec le fil Bilan : une PR par module, les plus gros d'abord ; chaque PR baisse le plafond de son module.
- [ ] Réduction, module par module (une ligne par PR ici, avec le nombre avant et après).

## Critères d'acceptation (tests, commandes, comportements observables)

- `pnpm test` : le test de plafond passe sur `main` et échoue si on ajoute un appel `withAdmin` dans un module sans toucher au plafond.
- Chaque PR de réduction : la politique de lignes qui remplace l'accès est testée (isolation entre deux créatrices), le plafond du module baisse.
- `pnpm check` et la CI verts.

## Hors périmètre

- Un rôle de base par module (écarté par l'ADR 0087).
- Les droits d'écriture du rôle de service, déjà figés par `service-role.integration.test.ts`.

## Règle pour les autres fils

Un accès nouveau passe par `withTenant` ou `withMember`, avec une politique de lignes écrite pour lui. S'il doit vraiment traverser les créatrices (une tâche sur toutes, une table que le rôle applicatif ne lit jamais), le plafond monte dans la même PR, la fiche de tâche dit pourquoi, et le fil Sécurité relit.

## Notes de session

- 20/11/2026, limites connues du compte (relecture Bilan) : il reconnaît la connexion de service sous le nom `adminDb` ; passée sous un autre nom, une requête directe n'est pas comptée, donc on ne la renomme pas. Les commentaires sont retirés avant de compter : un `//` écrit dans une chaîne coupe la fin de sa ligne. Les deux sont à lever avec la réduction, quand le compte passera par l'arbre syntaxique.
