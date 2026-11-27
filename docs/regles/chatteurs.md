# Le chatteur : shift, copilote, rapports, relecture

Ce que le chatteur fait pendant son shift, ce que le copilote lui montre, comment son travail est relu et compté.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

## Lire d’abord

- [`docs/architecture/message-flow.md`](../architecture/message-flow.md)

## Décisions, de la plus ancienne à la plus récente

- **0025** · [Le chatteur chatte dans Reveal ; dans Nirvana, il traite sa créatrice pendant son shift, et rien hors shift](../adr/0025-chatter-access-during-shift.md) — acceptée ; en partie changée par [Créneaux libres, plusieurs chatteurs sur un compte, fans confiés ; la créatrice sans notification de shift](../adr/0049-free-slots-seats-and-shared-fans.md)
  - précisée ou complétée par : [0050](../adr/0050-reveal-two-paths-crm-api-and-captured-session.md), [0052](../adr/0052-persona-watch-on-chatter-messages.md), [0086](../adr/0086-copilot-side-panel-next-to-reveal.md), [0101](../adr/0101-sale-given-to-the-decisive-chatter.md), [0109](../adr/0109-chatter-extension-writes-the-fan-card.md), [0124](../adr/0124-every-fan-listed-for-the-agency.md), [0141](../adr/0141-copilot-that-helps-the-chatter.md), [0153](../adr/0153-chatter-sees-a-short-creator-sheet-on-shift.md), [0170](../adr/0170-shift-feedback-and-chatter-review.md)
- **0043** · [Chatteur : ventes saisies une à une, rapport de fin de shift contrôlé par le code, retours de l'IA sans effet sur la paie](../adr/0043-chatter-sale-entries-and-report-check.md) — acceptée ; en partie changée par [Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste](../adr/0050-reveal-two-paths-crm-api-and-captured-session.md), [Rapport déclaré sur Reveal : l'écart avec les ventes lues se voit, s'explique et se tranche par un humain](../adr/0073-declared-reports-checked-against-reveal-sales.md)
  - précisée ou complétée par : [0049](../adr/0049-free-slots-seats-and-shared-fans.md), [0052](../adr/0052-persona-watch-on-chatter-messages.md), [0054](../adr/0054-creator-earnings-read-from-platform.md), [0078](../adr/0078-agency-sales-insights-from-the-register.md), [0092](../adr/0092-agency-steering-chatter-value-changes-and-fans.md), [0101](../adr/0101-sale-given-to-the-decisive-chatter.md), [0104](../adr/0104-chatter-own-figures-and-game.md), [0124](../adr/0124-every-fan-listed-for-the-agency.md)
- **0052** · [Le chatteur sous l'œil de la persona : chaque message qu'il écrit dans Reveal est relu, chaque écart lui est signalé, rien n'est bloqué ni retenu sur sa paie](../adr/0052-persona-watch-on-chatter-messages.md) — acceptée ; en partie changée par [Écarts de persona sur Telegram : les interdits graves tout de suite, les autres au bilan du soir, jamais un nom](../adr/0059-persona-slips-on-telegram.md)
- **0073** · [Rapport déclaré sur Reveal : l'écart avec les ventes lues se voit, s'explique et se tranche par un humain](../adr/0073-declared-reports-checked-against-reveal-sales.md) — acceptée
  - précisée ou complétée par : [0077](../adr/0077-shift-report-reminded-on-the-phone.md)
- **0077** · [Rapport de fin de shift : Impera le rappelle au chatteur sur son téléphone](../adr/0077-shift-report-reminded-on-the-phone.md) — acceptée
- **0086** · [Le panneau copilote : à côté de la conversation Reveal, la fiche du fan d'abord, le brouillon de l'agent ensuite, et c'est le chatteur qui envoie](../adr/0086-copilot-side-panel-next-to-reveal.md) — acceptée
  - précisée ou complétée par : [0109](../adr/0109-chatter-extension-writes-the-fan-card.md), [0132](../adr/0132-spender-tiers-per-creator.md), [0133](../adr/0133-agent-reacts-to-fan-messages.md), [0135](../adr/0135-time-waster-scarce-attention.md), [0141](../adr/0141-copilot-that-helps-the-chatter.md)
- **0101** · [Une vente donnée, entière ou partagée, au chatteur qui a été décisif](../adr/0101-sale-given-to-the-decisive-chatter.md) — acceptée
- **0104** · [Le chatteur voit ses propres chiffres, et un jeu fait de faits réels l'accompagne](../adr/0104-chatter-own-figures-and-game.md) — acceptée
  - précisée ou complétée par : [0107](../adr/0107-creator-trophies-and-series.md), [0108](../adr/0108-trophy-case-shared-by-chatter-and-creator.md), [0118](../adr/0118-validated-reports-feed-the-game.md)
- **0108** · [Une vitrine des trophées commune au chatteur et à la créatrice](../adr/0108-trophy-case-shared-by-chatter-and-creator.md) — acceptée
  - précisée ou complétée par : [0118](../adr/0118-validated-reports-feed-the-game.md)
- **0118** · [Les rapports validés nourrissent le jeu du chatteur](../adr/0118-validated-reports-feed-the-game.md) — acceptée
- **0141** · [Un copilote qui aide vraiment le chatteur : quoi faire, pourquoi, où en est la vente, et des accroches à la demande](../adr/0141-copilot-that-helps-the-chatter.md) — acceptée
- **0153** · [Le chatteur voit, pendant son shift, une fiche courte de la créatrice : qui elle est, comment elle écrit, ce qu'elle ne fait jamais](../adr/0153-chatter-sees-a-short-creator-sheet-on-shift.md) — acceptée
- **0170** · [Les retours de shift servent à l'IA, et l'IA relit les shifts des chatteurs pour un bilan de coach](../adr/0170-shift-feedback-and-chatter-review.md) — acceptée

Retour au [sommaire des règles](README.md).
