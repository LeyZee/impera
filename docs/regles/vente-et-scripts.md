# Vente et scripts

Les scripts de vente, leur déroulé fan par fan, le prix, les pauses, le sur-mesure, les fans qui n’achètent pas.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

> Le détail du métier (ce qu'elle dit, comment elle séduit et vend) vit dans la méthode de chatting de l'agence, tenue hors de ce dépôt public. Si une décision d'ici la contredit, on le signale à Charles ; on ne tranche pas ici.

## Lire d’abord

- [`docs/architecture/message-flow.md`](../architecture/message-flow.md)
- [`docs/reference/media-vocabulary.md`](../reference/media-vocabulary.md)

## Décisions, de la plus ancienne à la plus récente

- **0056** · [Scripts : l'agence écrit ses structures, la créatrice tourne carton par carton, Nirvana range dans l'ordre et téléverse](../adr/0056-scripts-shot-by-the-creator-with-cards.md) — acceptée ; en partie changée par [Cartons de script : la couleur du script et le dessin d'OnlyScript](../adr/0064-script-cards-in-the-script-colour.md)
  - précisée ou complétée par : [0060](../adr/0060-trend-watch-and-content-ideas.md), [0083](../adr/0083-creator-media-described-on-drop.md), [0098](../adr/0098-script-runs-per-fan.md), [0128](../adr/0128-sparing-sales-scripts.md), [0131](../adr/0131-script-choice-by-fan-tastes.md), [0140](../adr/0140-creator-week-shoot-days-and-delivery.md), [0145](../adr/0145-vault-folders-by-role.md)
- **0064** · [Cartons de script : la couleur du script et le dessin d'OnlyScript](../adr/0064-script-cards-in-the-script-colour.md) — acceptée
  - précisée ou complétée par : [0098](../adr/0098-script-runs-per-fan.md)
- **0090** · [Une demande sur mesure passe à un chatteur qui prend la commande ; une objection de prix reçoit une réplique de la banque de l'agence](../adr/0090-custom-order-handoff-and-objection-replies.md) — acceptée ; en partie changée par [Une demande sur mesure passe par l'accord et le prix de la créatrice ; l'IA prend la commande avec un acompte par pourboire et livre depuis un dossier rattaché au fan](../adr/0159-custom-order-creator-price-and-tip-deposit.md)
  - précisée ou complétée par : [0111](../adr/0111-heart-game-judged-by-code.md), [0112](../adr/0112-branched-sales-scripts.md)
- **0098** · [Le déroulé d'un script se tient fan par fan : le code choisit l'étape et le prix, la voix ne fait que les dire](../adr/0098-script-runs-per-fan.md) — acceptée ; en partie changée par [Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse](../adr/0161-only-our-scripts-impera-to-reveal.md)
  - précisée ou complétée par : [0100](../adr/0100-ai-writes-scripts-for-the-vault.md), [0111](../adr/0111-heart-game-judged-by-code.md), [0112](../adr/0112-branched-sales-scripts.md), [0128](../adr/0128-sparing-sales-scripts.md), [0129](../adr/0129-sales-script-performance.md), [0131](../adr/0131-script-choice-by-fan-tastes.md), [0132](../adr/0132-spender-tiers-per-creator.md), [0141](../adr/0141-copilot-that-helps-the-chatter.md)
- **0099** · [Synchroniser le coffre Reveal et bâtir des scripts avec ses médias, sans rien téléverser](../adr/0099-scripts-built-from-the-reveal-vault.md) — acceptée ; en partie changée par [Les dossiers du coffre ont un rôle : un dossier par script, une réserve Mass DM et une réserve Feed, le code lit le rôle et jamais le nom](../adr/0145-vault-folders-by-role.md), [Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse](../adr/0161-only-our-scripts-impera-to-reveal.md)
  - précisée ou complétée par : [0100](../adr/0100-ai-writes-scripts-for-the-vault.md), [0111](../adr/0111-heart-game-judged-by-code.md), [0112](../adr/0112-branched-sales-scripts.md), [0113](../adr/0113-vault-media-read-then-erased.md), [0138](../adr/0138-sharp-vault-preview-read-on-demand.md), [0149](../adr/0149-creator-sheet-in-seven-tabs.md)
- **0100** · [Une IA écrit les scripts à partir des médias du coffre, le code tient la vente](../adr/0100-ai-writes-scripts-for-the-vault.md) — acceptée
  - précisée ou complétée par : [0112](../adr/0112-branched-sales-scripts.md)
- **0111** · [Le jeu des cœurs : le code juge la réponse, l'agent joue, la récompense part une fois](../adr/0111-heart-game-judged-by-code.md) — acceptée
- **0112** · [Scripts à branches : les étapes et les branches de la plateforme, le code choisit la branche, la voix la dit](../adr/0112-branched-sales-scripts.md) — acceptée ; en partie changée par [Paliers de dépense : l'IA est plus proche et plus attentive avec ceux qui ont beaucoup dépensé, jamais plus pressante ; un prix plus haut par une branche de palier](../adr/0132-spender-tiers-per-creator.md), [Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse](../adr/0161-only-our-scripts-impera-to-reveal.md)
  - précisée ou complétée par : [0128](../adr/0128-sparing-sales-scripts.md), [0129](../adr/0129-sales-script-performance.md), [0131](../adr/0131-script-choice-by-fan-tastes.md), [0135](../adr/0135-time-waster-scarce-attention.md), [0141](../adr/0141-copilot-that-helps-the-chatter.md), [0149](../adr/0149-creator-sheet-in-seven-tabs.md)
- **0113** · [Les fichiers du coffre : lus le temps de la description, jamais gardés](../adr/0113-vault-media-read-then-erased.md) — acceptée ; en partie changée par [Les dossiers du coffre ont un rôle : un dossier par script, une réserve Mass DM et une réserve Feed, le code lit le rôle et jamais le nom](../adr/0145-vault-folders-by-role.md)
- **0128** · [Ménager les scripts : une pause après un achat, un script rejoué par une autre variante du teasing, l'IA qui réclame des scripts](../adr/0128-sparing-sales-scripts.md) — acceptée
  - précisée ou complétée par : [0129](../adr/0129-sales-script-performance.md), [0132](../adr/0132-spender-tiers-per-creator.md), [0135](../adr/0135-time-waster-scarce-attention.md), [0150](../adr/0150-creator-alerts-by-role.md)
- **0129** · [Mesurer les scripts de vente : l'entonnoir par étape, le revenu par fan exposé, ce qui casse et pourquoi](../adr/0129-sales-script-performance.md) — acceptée
- **0131** · [Choisir le script qui colle à ce que le fan aime : familles de fantasme et goûts](../adr/0131-script-choice-by-fan-tastes.md) — proposée, pas encore acceptée
  - précisée ou complétée par : [0132](../adr/0132-spender-tiers-per-creator.md), [0135](../adr/0135-time-waster-scarce-attention.md)
- **0132** · [Paliers de dépense : l'IA est plus proche et plus attentive avec ceux qui ont beaucoup dépensé, jamais plus pressante ; un prix plus haut par une branche de palier](../adr/0132-spender-tiers-per-creator.md) — acceptée
  - précisée ou complétée par : [0135](../adr/0135-time-waster-scarce-attention.md)
- **0135** · [Time waster : le fan qui parle sans jamais acheter reçoit une attention rare, jamais du mépris ; le premier achat la lui rend](../adr/0135-time-waster-scarce-attention.md) — acceptée
  - précisée ou complétée par : [0159](../adr/0159-custom-order-creator-price-and-tip-deposit.md)
- **0138** · [Aperçu net du coffre : la petite image de Reveal lue à la demande, servie sans être gardée](../adr/0138-sharp-vault-preview-read-on-demand.md) — acceptée
- **0145** · [Les dossiers du coffre ont un rôle : un dossier par script, une réserve Mass DM et une réserve Feed, le code lit le rôle et jamais le nom](../adr/0145-vault-folders-by-role.md) — acceptée
  - précisée ou complétée par : [0149](../adr/0149-creator-sheet-in-seven-tabs.md), [0159](../adr/0159-custom-order-creator-price-and-tip-deposit.md)
- **0156** · [Après une étape payante, elle continue de chatter : achat, refus, oubli, paiement, relances](../adr/0156-after-a-paid-step-she-keeps-chatting.md) — acceptée ; en partie changée par [Elle a du caractère, et elle vend comme une fille : au revoir, bouderie, lassitude, répartie, mémoire datée, rythme d'un script](../adr/0158-she-has-character-and-sells-like-a-girl.md)
- **0159** · [Une demande sur mesure passe par l'accord et le prix de la créatrice ; l'IA prend la commande avec un acompte par pourboire et livre depuis un dossier rattaché au fan](../adr/0159-custom-order-creator-price-and-tip-deposit.md) — acceptée
  - précisée ou complétée par : [0163](../adr/0163-coffre-impera-content-stock.md)

Retour au [sommaire des règles](README.md).
