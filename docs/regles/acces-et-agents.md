# Accès, sécurité des comptes, agents connectés

Connexion, deuxième facteur, durée des sessions, clés IA, comptes de secours, serveur MCP.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

## Lire d’abord

- [`docs/conventions/security.md`](../conventions/security.md)
- [`docs/architecture/threat-model.md`](../architecture/threat-model.md)

## Décisions, de la plus ancienne à la plus récente

- **0016** · [Les clés des fournisseurs IA se saisissent dans le dashboard, chiffrées en base](../adr/0016-provider-keys-entered-in-dashboard.md) — acceptée
  - précisée ou complétée par : [0057](../adr/0057-instagram-and-telegram-publishing-connectors.md), [0068](../adr/0068-owner-password-reset-and-second-factor-qr.md), [0075](../adr/0075-recette-sandbox-simulated-reveal-and-ai.md), [0091](../adr/0091-ai-spend-and-prepaid-credits.md), [0120](../adr/0120-read-instagram-and-link-clicks-before-publishing.md)
- **0026** · [Serveur MCP de Nirvana : une seconde porte sur les mêmes commandes](../adr/0026-mcp-server.md) — acceptée ; en partie changée par [Un agent externe peut préparer et publier le contenu public de la créatrice, et seulement lui](../adr/0058-external-agents-may-publish.md), [Le MCP d'Impera remis à jour : un agent connecté lit, freine et prépare, un humain confirme](../adr/0105-mcp-agents-read-brake-and-prepare.md)
- **0046** · [Accès au dashboard : deuxième facteur, connexions bornées, alertes de sécurité](../adr/0046-dashboard-access-second-factor.md) — acceptée ; en partie changée par [Durée des sessions selon le rôle : le propriétaire 48 heures sans activité, la créatrice 7 jours, les autres 12 heures](../adr/0160-session-length-by-role.md)
  - précisée ou complétée par : [0068](../adr/0068-owner-password-reset-and-second-factor-qr.md), [0096](../adr/0096-rescue-owner.md)
- **0053** · [Clé d'accès (Face ID, empreinte) : un geste vaut mot de passe et code](../adr/0053-passkey-sign-in.md) — acceptée
- **0068** · [Mot de passe oublié du propriétaire et QR code de la validation en deux étapes](../adr/0068-owner-password-reset-and-second-factor-qr.md) — acceptée
  - précisée ou complétée par : [0096](../adr/0096-rescue-owner.md)
- **0096** · [Un compte propriétaire de secours](../adr/0096-rescue-owner.md) — acceptée
- **0105** · [Le MCP d'Impera remis à jour : un agent connecté lit, freine et prépare, un humain confirme](../adr/0105-mcp-agents-read-brake-and-prepare.md) — acceptée
  - précisée ou complétée par : [0144](../adr/0144-mcp-follows-the-crm-of-november.md)
- **0144** · [Le MCP suit le CRM de novembre : ce qui est arrivé depuis l'ADR 0105, en lecture seule](../adr/0144-mcp-follows-the-crm-of-november.md) — acceptée
- **0160** · [Durée des sessions selon le rôle : le propriétaire 48 heures sans activité, la créatrice 7 jours, les autres 12 heures](../adr/0160-session-length-by-role.md) — acceptée

Retour au [sommaire des règles](README.md).
