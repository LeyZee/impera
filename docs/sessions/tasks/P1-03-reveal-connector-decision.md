# P1-03 Décision B/C et spécification du connecteur Reveal

Statut : done
Phase : 1
Dépend de : P1-02
Branche : task/p1-03-reveal-connector-decision

## Objectif
Confirmer ou amender ADR 0008 à la lumière de P1-02, et écrire la spécification du `RevealApiConnector` (ou `RevealBrowserConnector`) assez précise pour que les fiches P2 soient mécaniques.

## Contexte à lire
ADR 0008, `connectors.md`, `reveal-api-observed.md` (rempli), `threat-model.md` (bannissement, détection), CGU Reveal (lues par Charles, résumé à demander).

## À faire
- Tableau de faisabilité B : auth rejouable depuis un serveur ? signatures reproductibles ? anti-bot sur l'API ? durée de session ? invalidation ?
- Si B est faisable : spécification du client (endpoints, mappage vers `ExternalMessage`/`ConversationSnapshot`, détection des ventes, upload média, `verifySent`, rythme, egress), plan de capture de session (ce que l'extension doit lire exactement).
- Si B est bloqué : ADR nouvelle (`proposed`) qui bascule sur C avec son coût (navigateur persistant, profil, mémoire), et spécification équivalente.
- Dans les deux cas : liste des risques et des signaux de détection à surveiller, et comment l'enregistreur servira à détecter les changements d'API.
- Découper la phase 2 en fiches P2-01… (session + capture, lecture, envoi manuel, réconciliation, runbooks testés, déploiement).

## Critères d'acceptation
- ADR 0008 `accepted` confirmée (note datée) ou nouvelle ADR `proposed` avec justification chiffrée.
- Fiches P2 créées avec critères d'acceptation ; index mis à jour.
- Résumé des clauses CGU pertinentes consigné dans `reveal-api-observed.md` (section Juridique), avec la décision de Charles.

## Hors périmètre
Code du connecteur.

## Notes de session

- 2026-11-11 (fil Bilan) : faisabilité, décision et spécification dans `docs/reference/reveal-connector-spec.md`. B confirmée sur le fond : un seul en-tête `Bearer`, ni signature, ni nonce, ni anti-bot, ni WebSocket. Restent deux vérifications en lecture seule (V1 : jeton utilisable depuis un serveur ; V2 : durée de vie et réponse d'un jeton mort), placées dans P2-01 parce qu'elles demandent la session réelle et l'accord de Charles. Si V1 échoue, ADR `proposed` pour C avant P2-02.
- L'ADR 0008 étant immuable une fois acceptée (`docs/adr/README.md`), la confirmation n'y est pas écrite : elle est dans la spécification § 1 et dans la ligne 0008 de l'index des ADR. Aucune ADR nouvelle.
- CGU lues sur les pages publiques (section Juridique de `reveal-api-observed.md`) : l'agence a le droit d'écrire au nom de la créatrice (art. 5.3), mais l'art. 9 interdit « tout logiciel activant ou comprenant tout ou partie de la Plateforme » et la rétro-ingénierie. Les articles 11 à 13 n'ont pas pu être lus. La décision de continuer en B malgré ce risque revient à Charles.
- Idempotence : Reveal n'accepte aucune clé ; la spécification § 5 prévoit une table `connector_sends` (migration à demander dans P2-03).
- Fiches P2-01 à P2-06 créées ; P2-02 et P2-03 reprennent `PROPOSED-reveal-connector.md`.
- 2026-11-11 : Charles choisit « Continuer » (voie B malgré l'art. 9), consigné dans la section Juridique de `reveal-api-observed.md`.
