# Coffre Reveal : créer une étape et une séquence de script dans Reveal
Statut : proposed (ID à donner ; ADR 0099 § 6 ; propriétaire proposé : Bilan, à ajouter aux écritures de P2-03)
Phase : 6
Dépend de : P2-03 (garde d'écriture, envoi réel), capture ciblée de `POST /scripts`, `POST /script-sequences`, `PUT /script-sequences/:id/steps`
Branche : task/<id>-vault-script-write

## Objectif
Le connecteur crée dans Reveal une séquence et ses étapes qui référencent des médias déjà dans le coffre, sans rien téléverser, derrière la garde d'écriture.

## Contexte à lire
ADR 0018 § 3, ADR 0099 § 6, `docs/reference/reveal-api-observed.md` (« Non utilisés »), fiche P2-03.

## À faire
- [ ] Capture ciblée sur le PC de Charles (tour à demander) : forme des trois appels, réponses, erreurs ; anonymisée, jamais de .har partagé.
- [ ] Capacités `createScriptStep` et `createScriptSequence` (drapeau `scriptWrite`), clé d'idempotence, `run(…, writes: true)` ; `FakeReveal` d'abord.
- [ ] Reprise : une séquence à moitié créée reprend à l'étape atteinte, sans doublon.
- [ ] Jamais de modification ni de suppression d'un script Reveal ; un script créé est relu par la synchronisation suivante.
- [ ] Rien pour une créatrice archivée.

## Critères d'acceptation
- Tests contre `FakeReveal` : garde fermée = rien ne part ; double clic = un seul script ; coupure au milieu puis reprise ; le script créé réapparaît à l'import.

## Hors périmètre
Téléversement de médias (SC-06), textes écrits par l'IA.

## Notes de session
