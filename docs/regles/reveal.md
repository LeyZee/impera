# Reveal et l’extension

Comment Impera lit et écrit chez Reveal, et ce que fait l’extension Chrome.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

## Lire d’abord

- [`docs/architecture/connectors.md`](../architecture/connectors.md)
- [`docs/reference/reveal-connector-spec.md`](../reference/reveal-connector-spec.md)
- [`docs/reference/reveal-api-observed.md`](../reference/reveal-api-observed.md)

## Décisions, de la plus ancienne à la plus récente

- **0008** · [Port `PlatformConnector` ; Reveal via session capturée et client API serveur](../adr/0008-platform-connector-port-and-reveal-strategy.md) — acceptée
  - précisée ou complétée par : [0050](../adr/0050-reveal-two-paths-crm-api-and-captured-session.md), [0066](../adr/0066-extension-popup-uses-the-crm-session.md), [0075](../adr/0075-recette-sandbox-simulated-reveal-and-ai.md)
- **0018** · [Port connecteur étendu : scripts natifs, notes, coffre, médias, garde d'écriture](../adr/0018-extended-connector-port.md) — acceptée ; en partie changée par [Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste](../adr/0050-reveal-two-paths-crm-api-and-captured-session.md)
  - précisée ou complétée par : [0056](../adr/0056-scripts-shot-by-the-creator-with-cards.md), [0073](../adr/0073-declared-reports-checked-against-reveal-sales.md), [0085](../adr/0085-fan-card-filled-by-the-ai.md), [0098](../adr/0098-script-runs-per-fan.md), [0099](../adr/0099-scripts-built-from-the-reveal-vault.md), [0110](../adr/0110-agent-and-reveal-automations.md), [0113](../adr/0113-vault-media-read-then-erased.md), [0117](../adr/0117-agent-writes-fan-first-name-and-note.md), [0133](../adr/0133-agent-reacts-to-fan-messages.md), [0138](../adr/0138-sharp-vault-preview-read-on-demand.md), [0145](../adr/0145-vault-folders-by-role.md), [0154](../adr/0154-agent-knows-her-platform-bio.md), [0159](../adr/0159-custom-order-creator-price-and-tip-deposit.md)
- **0050** · [Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste](../adr/0050-reveal-two-paths-crm-api-and-captured-session.md) — acceptée ; en partie changée par [La quinzaine vérifiée peut être la première payée sur les ventes Reveal](../adr/0084-checked-fortnight-paid-on-platform-net.md), [Une vente donnée, entière ou partagée, au chatteur qui a été décisif](../adr/0101-sale-given-to-the-decisive-chatter.md)
  - précisée ou complétée par : [0054](../adr/0054-creator-earnings-read-from-platform.md), [0069](../adr/0069-creators-imported-from-reveal-after-review.md), [0073](../adr/0073-declared-reports-checked-against-reveal-sales.md), [0075](../adr/0075-recette-sandbox-simulated-reveal-and-ai.md), [0076](../adr/0076-team-imported-from-reveal-after-review.md), [0078](../adr/0078-agency-sales-insights-from-the-register.md), [0081](../adr/0081-daily-platform-stats-snapshot.md), [0104](../adr/0104-chatter-own-figures-and-game.md), [0147](../adr/0147-reveal-session-synced-when-the-popup-opens.md), [0170](../adr/0170-shift-feedback-and-chatter-review.md)
- **0066** · [Le popup de l'extension : la connexion est celle du CRM, l'extension ne garde aucun secret de connexion](../adr/0066-extension-popup-uses-the-crm-session.md) — acceptée
  - précisée ou complétée par : [0067](../adr/0067-extension-installed-from-the-crm.md), [0086](../adr/0086-copilot-side-panel-next-to-reveal.md), [0109](../adr/0109-chatter-extension-writes-the-fan-card.md), [0134](../adr/0134-navigation-by-gesture.md), [0147](../adr/0147-reveal-session-synced-when-the-popup-opens.md)
- **0067** · [L'équipe installe l'extension depuis le CRM, puis depuis le Chrome Web Store en « non répertoriée »](../adr/0067-extension-installed-from-the-crm.md) — acceptée
  - précisée ou complétée par : [0152](../adr/0152-hosting-hostinger-vps-and-supabase.md)
- **0069** · [Les créatrices s'importent depuis Reveal par une revue du propriétaire, jamais en silence](../adr/0069-creators-imported-from-reveal-after-review.md) — acceptée
  - précisée ou complétée par : [0071](../adr/0071-creators-renamed-and-archived-nothing-deleted.md), [0076](../adr/0076-team-imported-from-reveal-after-review.md)
- **0075** · [Bac à sable de recette : Reveal et IA simulés, jamais actifs hors développement](../adr/0075-recette-sandbox-simulated-reveal-and-ai.md) — acceptée
- **0076** · [L'équipe s'importe depuis Reveal par des suggestions confirmées, jamais en silence](../adr/0076-team-imported-from-reveal-after-review.md) — acceptée
- **0081** · [Les abonnés, les PPV envoyés et les messages se gardent en photo quotidienne lue chez la plateforme](../adr/0081-daily-platform-stats-snapshot.md) — acceptée
  - précisée ou complétée par : [0092](../adr/0092-agency-steering-chatter-value-changes-and-fans.md), [0146](../adr/0146-agency-calendar-periods-and-chosen-comparison.md)
- **0110** · [L'agent tient compte des automatisations de Reveal](../adr/0110-agent-and-reveal-automations.md) — acceptée
  - précisée ou complétée par : [0111](../adr/0111-heart-game-judged-by-code.md), [0137](../adr/0137-mass-dm-after-a-post-and-wake-up.md), [0154](../adr/0154-agent-knows-her-platform-bio.md)
- **0147** · [La session Reveal se synchronise seule à l'ouverture du popup](../adr/0147-reveal-session-synced-when-the-popup-opens.md) — acceptée
- **0161** · [Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse](../adr/0161-only-our-scripts-impera-to-reveal.md) — acceptée
  - précisée ou complétée par : [0163](../adr/0163-coffre-impera-content-stock.md)

Retour au [sommaire des règles](README.md).
