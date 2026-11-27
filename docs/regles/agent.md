# L’agent IA : persona, voix, sécurité de la conversation

Qui parle, avec quelle persona, dans quelle langue, et ce que le code interdit quoi qu’il arrive.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

> Le détail du métier (ce qu'elle dit, comment elle séduit et vend) vit dans la méthode de chatting de l'agence, tenue hors de ce dépôt public. Si une décision d'ici la contredit, on le signale à Charles ; on ne tranche pas ici.

## Lire d’abord

- [`docs/architecture/ai-engine.md`](../architecture/ai-engine.md)
- [`docs/reference/persona-schema.md`](../reference/persona-schema.md)
- [`docs/playbooks/edit-the-persona.md`](../playbooks/edit-the-persona.md)

## Décisions, de la plus ancienne à la plus récente

- **0012** · [`identity_policy` configurable, défaut `stay_in_character`](../adr/0012-identity-policy-config.md) — remplacée par [Rester en personnage est fixé dans le code, sans réglage](../adr/0021-stay-in-character-fixed-in-code.md)
- **0017** · [Vision : Gemini en natif, bascule sur Grok en images clés](../adr/0017-vision-gemini-with-grok-fallback.md) — acceptée
- **0021** · [Rester en personnage est fixé dans le code, sans réglage](../adr/0021-stay-in-character-fixed-in-code.md) — acceptée
  - précisée ou complétée par : [0049](../adr/0049-free-slots-seats-and-shared-fans.md), [0065](../adr/0065-creator-sees-who-wrote-and-fan-figures.md), [0088](../adr/0088-fan-in-distress-care-mode.md), [0090](../adr/0090-custom-order-handoff-and-objection-replies.md), [0100](../adr/0100-ai-writes-scripts-for-the-vault.md), [0111](../adr/0111-heart-game-judged-by-code.md), [0122](../adr/0122-instagram-comments-answered-in-her-voice.md), [0126](../adr/0126-creator-lives-pause-and-feed-the-agent.md), [0132](../adr/0132-spender-tiers-per-creator.md), [0133](../adr/0133-agent-reacts-to-fan-messages.md), [0135](../adr/0135-time-waster-scarce-attention.md), [0141](../adr/0141-copilot-that-helps-the-chatter.md), [0143](../adr/0143-her-practices-and-accounts.md), [0159](../adr/0159-custom-order-creator-price-and-tip-deposit.md)
- **0079** · [La fiche persona reprend la fiche Desirali, onglet par onglet et question par question](../adr/0079-persona-sheet-follows-desirali.md) — acceptée ; en partie changée par [Une demande sur mesure passe à un chatteur qui prend la commande ; une objection de prix reçoit une réplique de la banque de l'agence](../adr/0090-custom-order-handoff-and-objection-replies.md)
  - précisée ou complétée par : [0133](../adr/0133-agent-reacts-to-fan-messages.md), [0143](../adr/0143-her-practices-and-accounts.md), [0154](../adr/0154-agent-knows-her-platform-bio.md)
- **0088** · [Fan en détresse : l'agent lui répond en mode soin, ventes gelées dans le code, et un humain valide chaque réponse](../adr/0088-fan-in-distress-care-mode.md) — acceptée
  - précisée ou complétée par : [0126](../adr/0126-creator-lives-pause-and-feed-the-agent.md), [0132](../adr/0132-spender-tiers-per-creator.md), [0133](../adr/0133-agent-reacts-to-fan-messages.md), [0135](../adr/0135-time-waster-scarce-attention.md), [0143](../adr/0143-her-practices-and-accounts.md), [0156](../adr/0156-after-a-paid-step-she-keeps-chatting.md), [0159](../adr/0159-custom-order-creator-price-and-tip-deposit.md)
- **0102** · [Les réponses corrigées au playground deviennent la banque d'exemples de la créatrice, lue aussi par la prod](../adr/0102-playground-corrections-read-by-production.md) — acceptée
  - précisée ou complétée par : [0122](../adr/0122-instagram-comments-answered-in-her-voice.md), [0170](../adr/0170-shift-feedback-and-chatter-review.md), [0172](../adr/0172-fan-simule.md)
- **0103** · [Le playground en base : conversations, notes, cas rejouables, taux par version, calibrage du désir](../adr/0103-playground-kept-in-the-database.md) — acceptée
  - précisée ou complétée par : [0111](../adr/0111-heart-game-judged-by-code.md), [0112](../adr/0112-branched-sales-scripts.md), [0128](../adr/0128-sparing-sales-scripts.md), [0129](../adr/0129-sales-script-performance.md), [0156](../adr/0156-after-a-paid-step-she-keeps-chatting.md), [0172](../adr/0172-fan-simule.md)
- **0126** · [Les lives de la créatrice : l'agent se tait pendant, en parle après, et se relaie avec les chatteurs](../adr/0126-creator-lives-pause-and-feed-the-agent.md) — acceptée
  - précisée ou complétée par : [0136](../adr/0136-feed-and-stories-published-on-their-own.md), [0137](../adr/0137-mass-dm-after-a-post-and-wake-up.md), [0140](../adr/0140-creator-week-shoot-days-and-delivery.md), [0143](../adr/0143-her-practices-and-accounts.md), [0148](../adr/0148-ai-switch-per-creator-and-per-slot.md)
- **0133** · [L'agent pose une réaction sur un message du fan, en plus de sa réponse, quand le message la justifie](../adr/0133-agent-reacts-to-fan-messages.md) — acceptée
- **0143** · [Ses pratiques et savoir-faire, et ses comptes : l'agent en parle juste, sans rien inventer, et oriente le fan vers le bon compte](../adr/0143-her-practices-and-accounts.md) — acceptée
  - précisée ou complétée par : [0150](../adr/0150-creator-alerts-by-role.md)
- **0154** · [L'IA connaît la bio de la créatrice sur la plateforme](../adr/0154-agent-knows-her-platform-bio.md) — acceptée
- **0158** · [Elle a du caractère, et elle vend comme une fille : au revoir, bouderie, lassitude, répartie, mémoire datée, rythme d'un script](../adr/0158-she-has-character-and-sells-like-a-girl.md) — acceptée
- **0168** · [La langue du fan est décidée par le code, donnée à la voix comme une consigne fixe, et les filets la lisent](../adr/0168-fan-language-decided-in-code.md) — acceptée
- **0172** · [Un fan joué par une IA teste l'agent sur des semaines fictives](../adr/0172-fan-simule.md) — proposée, pas encore acceptée

Retour au [sommaire des règles](README.md).
