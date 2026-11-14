# Module `mcp`

**Rôle.** Le serveur MCP d'Impera (ADR 0026, amendée par 0105) : une seconde porte, à côté des routes, par laquelle un agent connecté (d'abord une session Claude Code sur le PC de l'agence) lit le CRM, freine l'agent de chatting et prépare des gestes qu'un humain confirme. Il ne porte aucune règle métier : chaque outil appelle la commande ou la requête de l'`index.ts` du module propriétaire, avec les droits de la personne de l'accès.

**État.** Lot a, première partie : les règles pures seulement (`domain/`). Les accès d'agent (`mcp_grants`), le transport `POST /v1/mcp`, le journal et le branchement des outils viennent quand le rôle de service de l'ADR 0087 est sur `main` (fiche `PROPOSED-mcp-read`).

**Peut dépendre de.** Aucun module pour l'instant ; les modules qu'il lit s'ajouteront avec le branchement des outils. Aucun module ne dépend de lui, et il n'importera jamais `@impera/db`.

**Tables possédées.** Aucune pour l'instant.

## Règles (domaine)

- `MCP_CATALOGUE` : chaque outil, sa capacité, sa portée (une créatrice, l'agence, l'accès lui-même). Le lot a ne fait que lire. Un instantané fige le catalogue, et sa version (`MCP_CATALOGUE_VERSION`) part dans `serverInfo`.
- `decideCall` : l'intersection de 0026 § 4. Refus si le compte n'a pas son second facteur (0105 § 1), si l'accès n'a pas la capacité, si la capacité est réservée au propriétaire et que la personne ne l'est plus, si l'outil est propre à une créatrice et que l'accès n'en a pas, ou nomme une autre créatrice que la sienne, ou une créatrice que la personne ne lit plus. Le compte d'une créatrice ne lit jamais une conversation ni un fan (ADR 0023). La personne est relue à chaque appel (`resolveActor` d'`auth.ts`), jamais gardée en cache.
- `grantProblems` : `read:script_content` et `prepare:team` ne se cochent que sur un accès au nom du propriétaire (`MCP_OWNER_ONLY_CAPABILITIES`), et une capacité ne se coche qu'une fois.
- `NEVER_EXPOSED` : ce qu'aucun outil ne fait jamais (écrire à un fan, approuver, accélérer, clés, persona, paie, factures, taux, dossier prestataire, membres hors préparation, suppressions, exports, notes du chatteur, budget IA), en motifs sur les noms ; un test échoue si le catalogue en contient un.

## Structure

- `domain/` : catalogue, accès, liste « jamais exposé ». Zéro I/O.
- Pas encore d'`index.ts` : il naît avec le branchement des outils, quand un autre fichier l'importe.
