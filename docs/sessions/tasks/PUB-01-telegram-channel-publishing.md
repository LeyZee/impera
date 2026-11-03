# PUB-01 Connecteur de publication Telegram : le canal d'actualité de la créatrice
Statut : blocked (bot Telegram de Charles ; exemples de légendes de Charles)
Phase : publication (ADR 0057)
Dépend de : CR-06 (amendée), CR-08 (plan de la semaine), P3-07 (bot Telegram)
Branche : task/pub-01-telegram-channel

## Objectif
Les dépôts `telegram_post` entrent dans le plan de la semaine et partent sur le canal de la créatrice, avec une légende dans sa voix qui donne envie de venir sur Reveal.

## Contexte à lire
ADR 0057, ADR 0055, ADR 0044 § 3 et § 4, `docs/architecture/connectors.md`, P3-07.

## À faire
- [ ] Port des connecteurs de publication (propriétaire des contrats et du module `connectors`) et `FakeTelegramChannel`.
- [ ] Réglage du canal dans Réglages › Créatrices ; vérification que le bot y est administrateur.
- [ ] Compression sous 50 Mo, envoi, clé d'idempotence, échec en ambre.
- [ ] Prompt de légende versionné, à partir des exemples de Charles (à recueillir avant le code) ; gardes de voix ; rien de faux sur le prix, ni amour ni rencontre.
- [ ] Vues lues à 48 h.
- [ ] Idempotence (relecture Bilan) : `sendVideo` n'en a pas ; une réponse perdue (délai dépassé) passe en ambre, seul un refus explicite est repris.
- [ ] Le jeton du bot est lu par l'`index.ts` du module `telegram` (ou un port des secrets), jamais par sa table.
- [ ] Statistiques : des nombres seulement.

## Critères d'acceptation
- Tests contre le faux : double acceptation sans double message, bot non administrateur = ambre lisible.

## Hors périmètre
Instagram (PUB-02), agents externes (MCP-PUB).

## Notes de session
