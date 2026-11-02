# Mots de rencontre permis dans un refus (ID à donner par Charles)
Statut : done (PR de cette fiche)
Phase : 3
Dépend de : P3-13 (gardes de voix), décision de Charles du 02/11 à 01h00 (« Reveal n'interdit rien »)
Branche : claude/project-thread-e0j3ow (fil Agent)

## Objectif
La garde bloquante `platform_meeting_word` (P3-13) bloquait « rdv », « rendez-vous », « se rencontrer », « IRL » ou « se voir en vrai » même dans un refus, sur la foi d'un document qui décrit OnlyFans. Reveal ne repère aucun mot : Messa doit pouvoir dire « pas de rdv » ou « on ne va pas se rencontrer tu sais ». Ce qui reste interdit, c'est de proposer ou promettre une rencontre (`meeting_promise`, la voix, le juge).

## À faire
- [x] Retirer `platform_meeting_word` de `checkVoiceOutput` et sa liste (`PLATFORM_MEETING_WORDS`, `PLATFORM_MEETING_WORDS_VERSION`).
- [x] Garder le code dans `GUARD_CODES` (un code n'en sort jamais) et le marquer obsolète (`OBSOLETE_GUARD_CODES`) ; libellé du Playground (qui relit l'historique) dit « garde retirée » ; libellé web gardé en « un mot de rencontre », que le type exige mais qu'aucun serveur n'envoie plus.
- [x] Élargir `meeting_promise` aux rencontres proposées avec ces mots : « on se fait un rdv », « on prend rendez-vous », « rdv samedi », « rendez-vous le 06/12 », « rdv au café », « je te donne rendez-vous devant… », « on se voit en vrai ? », « on pourrait se rencontrer IRL ». « Rdv au prochain live » reste permis.
- [x] Tests : les refus passent, les propositions bloquent sous `meeting_promise`, réponses types de la persona (422) alignées.
- [x] Éval `meeting-refusal-no-word` devenue `meeting-refusal-no-promise` : sans date, sans lieu, sans promesse ; les mots ne sont plus interdits.
- [x] Docs : `ai-engine.md`, glossaire.

## Critères d'acceptation
- « Pas de rdv, désolée », « Un rendez-vous ? Non », « Pas d'IRL avec moi », « Se voir en vrai, jamais » ne bloquent plus rien.
- Toute rencontre proposée, avec ou sans ces mots, bloque.
- Un refus déjà enregistré avec `platform_meeting_word` reste lisible et nommé.

## Hors périmètre
Une liste de mots par plateforme : à décider le jour où une plateforme en interdit (ADR à écrire alors, le cœur ne connaît pas les plateformes).

## Notes de session
- 02/11 (fil Agent) : décision de seuil transmise par le coordinateur, à appliquer à la passation au chatteur en poste, pas dans cette fiche : la main passe dès que la note de désir atteint 70 (bande chaude), réglage d'agence modifiable depuis le CRM, pas une constante ; on montera à 85 si trop de fans partent chez les chatteurs (Charles a délégué le choix, 02/11 01h03).
- 02/11 : relance courte d'une offre non ouverte acceptée par Charles si adaptée au contexte ; demande un signal « offre vue » de Reveal, attendu de la capture.
