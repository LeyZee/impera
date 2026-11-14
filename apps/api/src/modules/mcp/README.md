# Module `mcp`

**Rôle.** Le serveur MCP d'Impera (ADR 0026, amendée par 0105) : une seconde porte, à côté des routes, par laquelle un agent connecté (d'abord une session Claude Code sur le PC de l'agence) lit le CRM, freine l'agent de chatting et prépare des gestes qu'un humain confirme. Il ne porte aucune règle métier : chaque outil appelle la commande ou la requête de l'`index.ts` du module propriétaire, avec les droits de la personne de l'accès.

**État.** Lot a en cours (fiche `PROPOSED-mcp-read`) : règles pures (`domain/`) et accès d'agent (`mcp_grants`, Réglages › Agents connectés). Le transport `POST /v1/mcp`, le journal et le branchement des outils viennent ensuite.

**Peut dépendre de.** Aucun module pour l'instant ; les modules qu'il lit s'ajouteront avec le branchement des outils. Aucun module ne dépend de lui. Seuls son magasin d'accès (`infra/db`) et son `index.ts` touchent `@impera/db` (règle ESLint) : un outil lit par l'`index.ts` du module propriétaire, jamais la base.

**Tables possédées.** `mcp_grants` (migration 0193) : l'accès d'agent (personne, créatrice au plus, capacités, empreinte SHA-256 du jeton, expiration à 90 jours au plus, révocation). Le propriétaire le lit, l'ajoute à son nom, le révoque et en note la dernière utilisation sous `withMember` ; personne ne le supprime ni ne change ce qu'il est (droits par colonne et déclencheur) ; une révocation est définitive. Le rôle de service le lit seulement, pour retrouver l'accès d'un jeton (`findByTokenHashUnscoped`, ADR 0087).

## Routes

- `GET /v1/settings/mcp-grants` : les accès du propriétaire, sans jeton ni empreinte.
- `POST /v1/settings/mcp-grants` (connexion récente) : crée un accès ; le jeton (`impmcp_` puis 43 caractères, règle `gitleaks` dédiée) n'est montré que dans cette réponse (`cache-control: no-store`). Aucune capacité cochée d'office ; refus 422 par sa sorte (`capability_repeated`, `owner_only`, `role_forbidden`).
- `DELETE /v1/settings/mcp-grants/:id` (connexion récente) : révoque, au journal.

## Règles (domaine)

- `MCP_CATALOGUE` : chaque outil, sa capacité, sa portée (une créatrice, l'agence, l'accès lui-même). Le lot a ne fait que lire. Un instantané fige le catalogue, et sa version (`MCP_CATALOGUE_VERSION`) part dans `serverInfo`.
- `decideCall` : l'intersection de 0026 § 4. Refus si le compte n'a pas son second facteur (0105 § 1), si l'accès n'a pas la capacité, si la capacité est réservée au propriétaire et que la personne ne l'est plus, si le rôle et la portée d'équipe de la personne ne l'ouvrent pas, si l'outil est propre à une créatrice et que l'accès n'en a pas, ou nomme une autre créatrice que la sienne, ou une créatrice que la personne ne lit plus. La personne est relue à chaque appel (`resolveActor` d'`auth.ts`), jamais gardée en cache. Une décision positive rend la créatrice à laquelle l'appel est borné : celle de l'accès, même sur un outil d'agence, que le répartiteur filtre, vérifiée comme sur un outil de créatrice (la personne la lit encore, l'appel n'en nomme pas une autre) ; aucune seulement pour un accès sans créatrice, qui ne peut alors en nommer aucune.
- Rôles en liste permise (`ALLOWED`, rôle et portée d'équipe vers capacités, le reste refusé) : le propriétaire tout ; un manager actif tout sauf ce qui est réservé au propriétaire, la paie et les dépôts ; un chatteur, ou un manager retombé à `self`, rien tant que l'accès borné au shift (ADR 0025) n'existe pas ; le compte d'une créatrice rien pour l'instant, car les outils d'agence de `read:status` montrent fans et conversations (ADR 0023) : son agent est un accès au nom du propriétaire, borné à elle (ADR 0026 § 3).
- `grantProblems` : `read:script_content` et `prepare:team` ne se cochent que sur un accès au nom du propriétaire (`MCP_OWNER_ONLY_CAPABILITIES`), une capacité ne se coche qu'une fois, et jamais au-delà de ce que la liste permise ouvre à la personne.
- `NEVER_EXPOSED` : ce qu'aucun outil ne fait jamais (écrire ou proposer à un fan, approuver ou confirmer, accélérer ou activer, clés, accès d'agent et second facteur, persona, paie, factures, taux, validations et publications, dossier prestataire, membres et scripts hors préparation, suppressions, exports, notes, budget IA et connecteurs), en motifs sur les noms ; un test échoue si le catalogue en contient un. C'est un filet pour relire un diff, pas une garantie : ce que fait un outil se vérifie dans son code, et le lot b ajoute la liste fermée des outils qui ne lisent pas.

## Structure

- `domain/` : catalogue, accès, liste « jamais exposé », ports. Zéro I/O.
- `application/grants.ts` : créer, lister, révoquer un accès ; retrouver l'accès vivant d'un jeton et noter son usage.
- `infra/db/grant-store.ts`, `infra/token.ts` (jeton et empreinte), `infra/http/routes.ts`.
