# Module `mcp`

**Rôle.** Le serveur MCP d'Impera (ADR 0026, amendée par 0105) : une seconde porte, à côté des routes, par laquelle un agent connecté (d'abord une session Claude Code sur le PC de l'agence) lit le CRM, freine l'agent de chatting et prépare des gestes qu'un humain confirme. Il ne porte aucune règle métier : chaque outil appelle la commande ou la requête de l'`index.ts` du module propriétaire, avec les droits de la personne de l'accès.

**État.** Lot a, première partie : les règles pures seulement (`domain/`). Les accès d'agent (`mcp_grants`), le transport `POST /v1/mcp`, le journal et le branchement des outils viennent quand le rôle de service de l'ADR 0087 est sur `main` (fiche `PROPOSED-mcp-read`).

**Peut dépendre de.** Aucun module pour l'instant ; les modules qu'il lit s'ajouteront avec le branchement des outils. Aucun module ne dépend de lui, et il n'importera jamais `@impera/db`.

**Tables possédées.** Aucune pour l'instant.

## Règles (domaine)

- `MCP_CATALOGUE` : chaque outil, sa capacité, sa portée (une créatrice, l'agence, l'accès lui-même). Le lot a ne fait que lire. Un instantané fige le catalogue, et sa version (`MCP_CATALOGUE_VERSION`) part dans `serverInfo`.
- `decideCall` : l'intersection de 0026 § 4. Refus si le compte n'a pas son second facteur (0105 § 1), si l'accès n'a pas la capacité, si la capacité est réservée au propriétaire et que la personne ne l'est plus, si le rôle et la portée d'équipe de la personne ne l'ouvrent pas, si l'outil est propre à une créatrice et que l'accès n'en a pas, ou nomme une autre créatrice que la sienne, ou une créatrice que la personne ne lit plus. La personne est relue à chaque appel (`resolveActor` d'`auth.ts`), jamais gardée en cache. Une décision positive rend la créatrice à laquelle l'appel est borné : celle de l'accès, même sur un outil d'agence, que le répartiteur filtre ; aucune seulement pour un accès sans créatrice.
- Rôles en liste permise (`ALLOWED`, rôle et portée d'équipe vers capacités, le reste refusé) : le propriétaire tout ; un manager actif tout sauf ce qui est réservé au propriétaire, la paie et les dépôts ; un chatteur, ou un manager retombé à `self`, rien tant que l'accès borné au shift (ADR 0025) n'existe pas ; une créatrice sa routine, ses ventes, qui est en poste, ses médias, ses tâches et ses dépôts, jamais une conversation, un fan, ni le travail ou la paie de l'équipe (ventes par chatteur, rapports de shift, import, relevés de commission ; ADR 0023).
- `grantProblems` : `read:script_content` et `prepare:team` ne se cochent que sur un accès au nom du propriétaire (`MCP_OWNER_ONLY_CAPABILITIES`), une capacité ne se coche qu'une fois, et jamais au-delà de ce que la liste permise ouvre à la personne.
- `NEVER_EXPOSED` : ce qu'aucun outil ne fait jamais (écrire ou proposer à un fan, approuver ou confirmer, accélérer ou activer, clés, accès d'agent et second facteur, persona, paie, factures, taux, validations et publications, dossier prestataire, membres et scripts hors préparation, suppressions, exports, notes, budget IA et connecteurs), en motifs sur les noms ; un test échoue si le catalogue en contient un. C'est un filet pour relire un diff, pas une garantie : ce que fait un outil se vérifie dans son code, et le lot b ajoute la liste fermée des outils qui ne lisent pas.

## Structure

- `domain/` : catalogue, accès, liste « jamais exposé ». Zéro I/O.
- Pas encore d'`index.ts` : il naît avec le branchement des outils, quand un autre fichier l'importe.
