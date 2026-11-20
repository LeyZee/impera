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
- [x] Plan de réduction arrêté avec le fil Bilan (20/11) : le fil Sécurité écrit, le propriétaire du module relit ; connecteurs d'abord ; chaque PR baisse le plafond de son module et, quand elle le peut, retire au rôle de service son droit d'écriture sur les tables de créatrices qu'elle sort.
- [ ] Réduction, module par module (une ligne par PR ici, avec le nombre avant et après).
  - [x] Connecteurs, statistiques du jour : les deux photos s'écrivent sous le rôle applicatif, une créatrice à la fois (`withTenantJob`, migration 0235) ; le rôle de service n'écrit plus ces deux tables. Plafond des connecteurs : 36 → 35 (la date de la lecture complète, donnée de l'agence, reste au service).
  - [ ] Connecteurs, registre des ventes et comptes.
  - [x] Dépôts de contenu, vignettes et descriptions des médias : les deux tâches lisent et écrivent dans la créatrice du média, sous le rôle applicatif (`withTenantJob`, tâche `drop_media`, migration 0236 : lecture des dépôts pour cette tâche seule). La créatrice nommée par la tâche n'est plus crue sur parole : un média d'une autre n'est pas trouvé. Plafond des dépôts de contenu : 29 → 23 (les deux rattrapages horaires, qui parcourent toutes les créatrices, restent au service).
  - [ ] Dépôts de contenu, réception des fichiers, conservation, synthèses de scripts, demandes.

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
- 20/11/2026, première réduction : la porte `withTenantJob` pose `app.job` en plus de la créatrice, pour que les politiques d'une tâche n'ouvrent rien aux sessions de compte. Une fonction commune pour parcourir toutes les créatrices (`forEachTenant`) viendra avec la première tâche qui en a besoin.
- 20/11/2026, deuxième réduction : `media_assets` suit déjà la créatrice de la transaction (politique commune), donc aucune politique nouvelle pour elle ; seules les trois tables des dépôts, fermées hors compte, reçoivent une lecture pour la tâche. Le rôle de service garde ses droits d'écriture sur ces tables tant que la réception et la conservation y passent encore.
