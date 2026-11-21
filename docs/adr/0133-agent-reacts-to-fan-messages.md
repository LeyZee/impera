# 0133. L'agent pose une réaction sur un message du fan, en plus de sa réponse, quand le message la justifie

Statut : accepted (demande de Charles du 16/11/2026, fil Adapter ; acceptée par Charles le 16/11/2026, « ok 0133 »)
Date : 2026-11-16
Précise : ADR 0018 (port connecteur, garde d'écriture, idempotence), ADR 0019 (copilote et automatique), ADR 0021 (rester en personnage), ADR 0086 (panneau copilote), ADR 0088 (mode soin), ADR 0079 (persona, emojis interdits). Ne remplace rien.

## Contexte

Sur Reveal, la créatrice peut poser une réaction (un emoji) sur un message du fan. Les chatteurs le font quand le message s'y prête : un rire sur une blague, un cœur sur un compliment mignon, un smiley coquin sur un message sexy. Charles le demande pour l'IA : « si ça justifie une réaction au message aussi, en plus de la réponse, faut pas hésiter à mettre une réaction ». Ça fait plus naturel.

Ce que la capture du fil Adapter montre, sans valeur réelle : un message porte une liste de réactions `{ id, emoji, modelId }`, et une réaction se pose par une écriture sur le message avec `{ emoji }`. La réaction d'un fan n'a pas encore été observée. Aujourd'hui, l'agent n'écrit que du texte (et les étapes de script, #816).

## Décision

### A. Qui décide

1. **Le cerveau lit, le code décide** (règle 3 du dépôt). Le cerveau rend, sur le dernier message du fan, ce que ce message appelle, parmi une liste fermée `ReactionFit` (`@impera/contracts`) : `laugh` (vraiment drôle), `love` (mignon, tendre, un compliment doux), `naughty` (sexy, coquin), `wow` (impressionnant, une belle photo de lui), `none`. Il ne choisit jamais l'emoji et ne décide jamais d'en poser un.

2. **Le code pose une réaction seulement si tout ceci est vrai** (`reactionDecision`, `agent/domain/reaction.ts`, pur et testé) :
   - le cerveau a lu autre chose que `none` ;
   - elle n'a réagi à aucun des deux messages précédents du fan, et jamais deux fois de suite avec le même emoji : une réaction reste un geste, pas un tic ;
   - une seule réaction par réponse, sur le message de sa rafale qui l'appelle, le dernier si plusieurs ;
   - `naughty` seulement si son âge est confirmé et que le curseur de sexualisation la laisse le suivre (`free` ou `suggestive_only`) ;
   - aucune sur un message où il refuse, discute un prix, demande s'il parle à une IA, ou sur un piège.

3. **Jamais de réaction** pendant un doute d'âge (`ageDisputed`), un mineur possible, un mode soin (ADR 0088), « ne plus lui écrire », un passage de main à un humain, ou quand elle ne répond pas (attente, relance). Dans ces cas, l'agent ne fait rien sur la conversation, une réaction pas plus qu'un message.

### B. Quel emoji

4. **Une table par défaut, bornée par sa fiche.** `laugh` → 😂, `love` → ❤️, `naughty` → 😏, `wow` → 😍. Un emoji de ses `emojis_forbidden` n'est jamais posé ; la réaction tombe alors. La liste des emojis que Reveal accepte en réaction est vérifiée par Bilan sur le compte fan « test » ; un emoji refusé par la plateforme n'est pas remplacé au hasard.

### C. Comment elle part

5. **Avec la réponse, avant elle.** Le brouillon porte une réaction facultative (`reaction: { platformMessageId, emoji }`). En automatique, elle part juste avant la première bulle, après le temps de lecture ; en copilote, le chatteur la voit dans le brouillon, peut l'enlever, et elle part quand il valide. Une réaction n'est jamais envoyée seule par l'agent.

6. **Port connecteur.** Une méthode optionnelle `reactToMessage?(conversationRef, platformMessageId, emoji, idempotencyKey)`, annoncée par une capacité `messageReactions`, avec les règles de l'ADR 0018 § 1 : erreurs typées, garde d'écriture au même point d'entrée, clé `reaction:<conversation>:<message du fan>`. Une réaction déjà posée sur ce message n'est jamais posée deux fois. `FakeReveal` la porte, avec le test de contrat. Le cœur ne connaît pas Reveal.

7. **Si l'envoi de la réaction échoue**, la réponse part quand même. Une réaction n'est jamais une raison de retenir un message. L'échec entre au journal.

### D. Trace et réglage

8. **Journal.** Un événement `reaction_sent` (conversation, message du fan, code `ReactionFit`, emoji), jamais le texte du fan. Le « Pourquoi » d'un brouillon, au playground et au Suivi, dit la lecture du cerveau et pourquoi le code a posé ou non la réaction.

9. **Un interrupteur par créatrice**, dans Réglages › Ventes de la créatrice (« Réactions aux messages », allumé par défaut une fois le lot livré). Pas de réglage de fréquence : la règle du § 2 est dans le code.

10. **Playground.** La réaction s'affiche sur le message du fan simulé, avec sa raison ; rien ne part.

## Partage du travail

| Lot | Contenu | Fil |
|---|---|---|
| a | `ReactionFit` au cerveau (prompt versionné), `reactionDecision`, table d'emojis, réaction dans le brouillon, playground, évals sur persona fictive (drôle, compliment, coquin sans âge, doute d'âge, deux fois de suite) | Agent |
| b | `reactToMessage` et la capacité `messageReactions` dans le connecteur, `FakeReveal`, test de contrat, emojis acceptés vérifiés sur « test » | Bilan |
| c | Envoi avant la première bulle (automatique) et à la validation (copilote), `reaction_sent`, interrupteur par créatrice | Agent + Bilan |
| d | La réaction dans le brouillon du copilote et du Suivi (la voir, l'enlever) | Extension / Design |

## Conséquences

Positives :
- Une conversation plus vivante, comme un chatteur attentif la tiendrait.
- Tout est borné par le code : ni réaction systématique, ni coquine trop tôt, ni geste pendant un doute ou une détresse.

Négatives, à surveiller :
- Un geste de plus à écrire chez Reveal, donc un appel et un point d'échec de plus, sans retenir la réponse.
- La lecture du cerveau peut se tromper sur l'humour : une réaction mal placée se voit. À relire sur le playground et les premières conversations réelles.
- Aucun envoi réel avant le mot de Charles, et d'abord sur le seul compte fan « test ».

## Alternatives rejetées

- **Laisser le modèle choisir l'emoji et le moment** : un tic de modèle deviendrait une règle de comportement que personne ne teste.
- **Réagir à chaque message** : c'est mécanique, l'inverse de ce qui est demandé.
- **Une réaction à la place d'une réponse** : elle ne remplace jamais un message ; un silence avec un emoji ressemble à un oubli.
