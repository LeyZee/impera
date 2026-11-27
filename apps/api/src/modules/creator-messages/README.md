# creator-messages

« Écrire à l'agence » (Charles, 21/11, trous béants n° 13). Une créatrice écrit à l'agence depuis son espace (une
question, une idée, un souci) ; le message attend dans l'« À faire » du propriétaire jusqu'à sa réponse, qui revient
sur la carte de la créatrice.

- `domain/` : les règles (une réponse, une seule fois ; la même réponse rejouée ne change rien), les ports, les erreurs.
- `infra/db/` : `creator_messages`, écrit par elle dans son compte (`withCreatorAccount`), lu par son propriétaire et un
  manager actif (`withTenantMember`), répondu par le propriétaire seul.
- `infra/http/` : `/v1/creator-space/messages` (elle), `/v1/creator-messages/waiting` (l'agence),
  `/v1/creators/:creatorId/messages/:id/answer` (le propriétaire).

Ses mots sont une donnée : rien n'entre dans un prompt.
