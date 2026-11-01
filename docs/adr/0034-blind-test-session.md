# 0034. Le test à l'aveugle est une séance : le serveur calcule le taux, à partir de 40 situations

Statut : proposed
Date : 2026-10-28
Complète : ADR 0019 (troisième condition du mode Automatique), ADR 0022 (version de la persona)
Fait exception, si Charles le valide : ADR 0023 § Rôles (la créatrice ne voit jamais une conversation ni un fan)

## Contexte

L'ADR 0019 fait du test à l'aveugle la troisième condition du mode Automatique : la créatrice juge des réponses sans savoir qui les a écrites, et le propriétaire enregistre le taux « sans retouche » obtenu, qui doit atteindre 80 %. Aujourd'hui, ce taux se tape à la main (`POST /v1/creators/:id/blind-tests { rate }`). Rien ne le relie à une séance réelle, à un nombre de situations, ni à la version de la voix et de la persona qui a écrit les réponses jugées. Un taux de 100 % sur trois réponses ouvrirait le verrou.

La fiche `docs/sessions/tasks/PROPOSED-blind-test.md` décrit le protocole de la séance. Trois de ses règles changent ce que le verrou accepte, ce qui demande une décision.

## Décision

- **Une séance, pas un chiffre.** Un test à l'aveugle est une séance (`blind_test_sessions`) ouverte pour la version active de la voix et de la persona. Elle porte ses cartes (`blind_test_cards`) et leurs verdicts. Le `POST` de `blind_tests` prend `{ sessionId }` et ne prend plus `{ rate }`. Le taux enregistré est celui que le serveur calcule sur les cartes de la séance : la part des cartes de l'agent jugées « je l'enverrais telle quelle ». Le seuil reste 80 % (ADR 0019).
- **Au moins 40 situations jugées.** Une séance de moins de 40 situations, chacune avec une carte humaine et une carte de l'agent jugées, ne peut pas être enregistrée. Le minimum est une constante du code, comme les seuils de l'ADR 0019.
- **La séance périme avec sa version.** Si la voix ou la persona change avant l'enregistrement, la séance passe `abandoned` et ne s'enregistre plus. Le propriétaire peut aussi l'abandonner lui-même ; la raison est gardée (`version_changed` ou `cancelled`). Une séance abandonnée ne s'enregistre jamais. Le dernier test enregistré d'une version décide, comme aujourd'hui.
- **Une seule mesure ouvre le verrou.** Le taux humain de référence, la part de « jamais » et la justesse des devinettes sur l'auteur sont rangés avec la séance et affichés. Ils n'ouvrent ni ne ferment rien. En faire des conditions demanderait une nouvelle ADR.
- **Rien ne sort de la séance.** Aucune carte n'est envoyée à un fan. Aucun événement de séance ne porte le texte d'une carte dans l'outbox : un avis « test enregistré » ne porte que le taux et la version.
- **Exception à l'ADR 0023, à valider par Charles.** La créatrice juge sur la session du propriétaire, pas sur un compte créatrice. Elle y voit des extraits de conversations réelles, avec les prénoms et pseudonymes des fans remplacés (« Fan A », « Fan B ») dans le contexte et dans les deux réponses. C'est la seule fois où une créatrice voit le contenu d'une conversation. Aucun droit d'un compte créatrice n'est élargi. Sans l'accord de Charles, le test se fait sur des conversations inventées, et la fiche est revue.

## Conséquences

- Une migration (numéro attribué par Bilan) ajoute les deux tables, en RLS par créatrice. Le `POST` de `blind_tests` change de corps. Le verrou `automaticGate` et le Dashboard lisent `blind_tests` sans changement.
- Rétention : quand la purge d'un fan efface ses messages ou ses faits (`docs/conventions/security.md`), les références d'une carte vers un message ou un appel `llm_calls` passent à NULL, et son texte est effacé. Le taux enregistré dans `blind_tests` reste.
- Les tests à l'aveugle déjà enregistrés par un taux tapé à la main restent dans la table. Ils ne valent que pour leur version, qui changera avant toute ouverture réelle de l'Automatique.
- La séance coûte des appels IA (un rejeu par situation), annoncés avant de commencer et comptés dans le budget du jour.

## Alternatives rejetées

- **Garder le taux tapé à la main** : rien ne prouve qu'il vient d'une séance, ni de la version active.
- **Pas de minimum de situations** : quelques cartes suffiraient à ouvrir le verrou.
- **Un compte créatrice ouvert pour l'occasion** : il élargirait un droit pour une seule séance, et resterait à refermer.
