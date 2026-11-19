# Module `instagram-comments` : les commentaires sous ses publications Instagram (ADR 0122, INS-04)

Un commentaire laissé sous une publication de la créatrice reçoit une issue (`comment_outcome`) : une réponse courte dans sa voix, rien, un masquage ou un relais à un humain. Les règles vivent ici, dans le code ; le modèle écrit, il ne décide ni d'un droit ni d'une suppression.

- **Peut dépendre de** : aucun module (feuille). `connectors` implémente son port par son `index.ts` (`FakeInstagram`).
- **Tables possédées** : aucune au lot a.
- **Jobs émis** : aucun au lot a.

## Lot a (fait) : règles pures et port

- `domain/ports.ts` : le port des commentaires, un drapeau par capacité (lire, répondre, masquer, réafficher, supprimer), et les refus de Meta par leur nom. Le port n'a aucune méthode pour commenter ailleurs, aimer, suivre ou écrire en privé.
- `domain/reply-guards.ts` : les gardes d'une réponse publique. Forme (150 caractères, un emoji, ni hashtag ni mention), garde Instagram des légendes, `public_explicit`, `repeated_reply`, et celles du chatting qui valent en public.
- `domain/outcome.ts` : ce que le code décide autour du modèle. Commentaire de son propre compte ignoré, doute sur l'âge et détresse relayés sans le modèle, auteur en doute ouvert muet, bornes par auteur et par fil, une réécriture puis rien, masquage derrière son interrupteur, relais groupés au-delà de la borne, suppression par le propriétaire seul.
- `domain/autonomy.ts` : quand l'autonomie peut être proposée, entre le plancher et le plafond du code.

Les contrats sont dans `packages/contracts/src/instagram-comments.ts`, avec la liste fermée des droits demandés à Meta : aucun droit de messagerie, et un droit non demandé est refusé.

## À venir

Le webhook, la table et les réglages (lot b, relu par Sécurité), le prompt et les évals (lot c, avec le fil Agent), l'onglet du Playground et les écrans (lot d). Rien n'appelle Meta : tout se joue contre `FakeInstagram` jusqu'au mot écrit de Charles.
