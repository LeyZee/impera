# MCP-PUB Publication par un agent externe : préparer, puis publier dans un plafond
Statut : blocked (ADR 0058 à accepter avec les mots de la dérogation ; lot 1 du MCP)
Phase : MCP (ADR 0026, 0058)
Dépend de : PROPOSED-mcp-read (lot 1), PUB-01, PUB-02, CR-08
Branche : task/mcp-pub-publishing

## Objectif
Un agent connecté (Grok, Claude, ChatGPT) prépare le plan de diffusion d'une créatrice avec `write:publication_plan`, puis publie lui-même avec `publish`, dans le plafond fixé par le propriétaire.

## Contexte à lire
ADR 0058, ADR 0026 (§ 4 et § 5), ADR 0057, ADR 0055.

## À faire
- [ ] Capacités et outils du catalogue (`publishable_drops_list`, `publication_plan_get`, `publication_upsert`, `publication_remove`, `publication_publish`) ; mise à jour du test « jamais exposé » pour qu'il garde toute la liste de l'ADR 0026 hors de la dérogation.
- [ ] Plafond par accès et par sortie (zéro par défaut), interrupteur par accès et global (coupé par défaut).
- [ ] Mêmes commandes, mêmes gardes, catégorie respectée, accord Instagram jamais contourné, `idempotencyKey` obligatoire, journal avec `grantId`.
- [ ] Nom de l'agent visible dans le plan et dans Publié (jamais chez la créatrice).

## Critères d'acceptation
- Tests : aucun outil ne touche un fan, un Mass DM, un script, un prix ; plafond atteint = refus ; interrupteur global coupé = refus ; légende refusée par la garde.

## Hors périmètre
Toute autre accélération de l'ADR 0026.

## Notes de session
