# P2-03 `RevealApiConnector` : envois et note client

Statut : todo
Phase : 2
Dépend de : P2-02
Branche : task/p2-03-reveal-connector-write

## Objectif
Le connecteur envoie un texte, une étape de script et un vocal, et écrit la note client, sans jamais envoyer deux fois, derrière la garde d'écriture.

## Contexte à lire
`docs/reference/reveal-connector-spec.md` § 5 ; ADR 0018 §§ 3 et 5 ; `connectors/application/outbound-sender.ts` ; `conversations/application/jobs/send.ts`.

## À faire
- Table `connector_sends` (numéro de migration demandé au coordinateur avant de nommer le fichier), FORCE RLS, et idempotence de la spécification § 5.
- `sendText`, `sendScriptStep` (relecture de l'historique juste avant, refus définitif si l'étape est déjà partie), `sendMedia` limité au vocal, `setFanNote` (relecture, remplacement du seul bloc de l'agence), `markRead`, `setTyping`.
- Limite propre : 20 envois par minute et par compte, 2 s entre deux envois d'une même conversation.
- FakeReveal : limite de 60 envois par minute avec `x-ratelimit-limit`, `-remaining`, `-reset` et 429 au-delà (remarque 1 de la relecture de #679) ; scénario « envoi accepté puis coupure ».

## Critères d'acceptation
- Contre FakeReveal : liste → conversation → profil, note → scripts et étapes déjà envoyées → envoi d'un texte, d'une étape, d'un vocal, d'une note → relecture cohérente.
- Coupure après acceptation : `verifySent` retrouve le message, aucun renvoi ; rejeu avec la même clé : aucun doublon.
- `writes: false` : aucune écriture ne part (test sur chaque méthode).
- Étape déjà envoyée au fan : refus, aucun appel d'envoi.

## Hors périmètre
Envoi au vrai Reveal (réservé au fan « test », sur demande de Charles, dans P2-05).

## Notes de session
