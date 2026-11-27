# Module `instagram-comments` : les commentaires sous ses publications Instagram (ADR 0122, INS-04)

Un commentaire laissé sous une publication de la créatrice reçoit une issue (`comment_outcome`) : une réponse courte dans sa voix, rien, un masquage ou un relais à un humain. Les règles vivent ici, dans le code ; le modèle écrit, il ne décide ni d'un droit ni d'une suppression.

- **Peut dépendre de** : aucun module (feuille). `connectors` implémente son port par son `index.ts` (`FakeInstagram`).
- **Tables possédées** : aucune au lot a.
- **Jobs émis** : aucun au lot a.

## Lot a (fait) : règles pures et port

- `domain/ports.ts` : le port des commentaires, un drapeau par capacité (lire, répondre, masquer, réafficher, supprimer), et les refus de Meta par leur nom. Le port n'a aucune méthode pour commenter ailleurs, aimer, suivre ou écrire en privé.
- `domain/reply-guards.ts` : les gardes d'une réponse publique. Forme (150 caractères, deux emojis au plus, ni hashtag ni mention), garde Instagram des légendes, `public_explicit`, `repeated_reply`, et celles du chatting qui valent en public.
- `domain/outcome.ts` : ce que le code décide autour du modèle. Commentaire de son propre compte ignoré, doute sur l'âge et détresse relayés sans le modèle, auteur en doute ouvert muet, bornes par auteur et par fil, une réécriture puis rien, masquage derrière son interrupteur, relais groupés au-delà de la borne, suppression par le propriétaire seul.
- `domain/autonomy.ts` : quand l'autonomie peut être proposée, entre le plancher et le plafond du code.

Les contrats sont dans `packages/contracts/src/instagram-comments.ts`, avec la liste fermée des droits demandés à Meta : aucun droit de messagerie, et un droit non demandé est refusé.

## Lot c (écrit) : la voix

- `domain/prompt-input.ts` : le bloc que lit le modèle. Commentaire et légende coupés, mentions de tiers et liens retirés ; sans réponse utilisable du modèle, rien (plafond du jour) ou un relais à un humain (sortie invalide).
- `packages/llm` : prompt `voice/instagram-comment`, méthode `instagramComment` du gateway, usage `instagram_comment` dans `llm_calls`. Le prompt ne porte aucune règle : les gardes passent après, dans le code.
- Module `agent` : `commentWriterPersona` rend sa fiche sans l'intime et ses gardes publiques.

## Lot e (écrit) : sa voix calibrée sur ses vraies réponses (amendement du 26/11)

- `domain/examples.ts` : les cinq paires « commentaire, sa réponse » de sa banque les plus proches du commentaire, par proximité de texte, sans modèle ; rendues dans le bloc `her_replies` du message.
- `domain/questions.ts` : une réponse sur trois au plus peut porter une question (`mayAsk`), décidé par le code ; la garde `unwanted_question` refuse les autres. Deux emojis au plus.
- `domain/examples.ts` donne aussi la forme de sa réponse la plus proche (`replyShapeOf`) : nombre d'emojis et point d'exclamation, dits au modèle.
- Le style public de l'agence (partie « public » du style de base actif) entre dans le système du prompt, dans le bloc `agency_public_style`.
- `domain/love.ts` : un commentaire qui dit « je t'aime » (`declaresLove`) ne reçoit que des emojis (`emojiOnly`) ; la garde `words_in_emoji_reply` refuse une réponse avec des mots.
- `pnpm comment-calibration` : sur le PC seulement, ses paires mises de côté, réponses du modèle comparées aux siennes à l'aveugle ; les textes restent sous `.scratch/`, seuls des chiffres en sortent.

## À venir

Le webhook, la table et les réglages (lot b, relu par Sécurité), le branchement et les évals du lot c, l'onglet du Playground et les écrans (lot d). Rien n'appelle Meta : tout se joue contre `FakeInstagram` jusqu'au mot écrit de Charles.
