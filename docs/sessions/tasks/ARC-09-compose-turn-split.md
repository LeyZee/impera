# ARC-09 `composeTurn` découpé en étapes nommées, sans rien changer à ce qu'il fait
Statut : done
Phase : exploitation
Dépend de : —
Branche : claude/project-thread-e0j3ow-compose-split

## Objectif (1 phrase)

`composeTurn` (`apps/api/src/modules/agent/infra/compose.ts`, plus de 2 200 lignes dont près de 700 pour la seule fonction) devient un court chef d'orchestre qui se lit de haut en bas, ses étapes sorties en fonctions nommées et testées, avec un comportement strictement identique (accord de Charles : pas une règle métier ne bouge).

## Contexte à lire (fichiers précis)

- `CLAUDE.md`, `docs/conventions/coding.md` (un fichier = une responsabilité, ~300 lignes), `docs/conventions/hygiene.md`.
- `apps/api/src/modules/agent/infra/compose.ts` et ses appelants : `infra/draft-composer.ts`, `modules/playground/infra/session.ts`, `apps/api/src/scripts/evals.ts`.
- `docs/glossary.md` : « Palier (d'un fan) » (`fan_tier`) et « Palier de rencontre » (`relationshipTier`).

## À faire (liste vérifiable)

- [x] Un test de caractérisation qui fait passer `composeTurn` sur des tours représentatifs (passerelle factice, créatrice de démonstration inventée) et garde en instantané tout ce qui en sort : le tour composé, ce que le cerveau et la voix ont reçu. Commité **avant** le découpage, sur le code inchangé.
- [x] Les consignes (textes envoyés à la voix) et les briefs écrits par le code sortis dans `domain/`, sans changer un caractère.
- [x] Les décisions pures du tour (contexte des gardes, choix des scripts, offre, sexualisation, commande perso, disponibilité, refus, suite d'une vente, registre, fantasme, consignes du tour) sorties dans `domain/`, chacune nommée, avec ses tests unitaires.
- [x] Les appels au modèle (relance, tour de la voix avec ses gardes et sa réécriture) dans de petits fichiers d'`infra/`.
- [x] Les deux choses nommées `fanTier` ne partagent plus de nom : le palier de rencontre (nombre, lu par la garde `close_only_word`) devient `meetingTier` ; le palier d'un fan (`FanTier`, lu par le sexto sans vente) garde le nom du glossaire. Glossaire mis à jour.
- [x] Aucune attente de test changée, aucun prompt ni version de prompt touché ; l'instantané de caractérisation reste identique à l'octet.

## Critères d'acceptation (tests, commandes, comportements observables)

- `pnpm check` vert ; les tests unitaires de `apps/api` (agent, conversations, playground et tous les autres), `packages/llm` et `packages/contracts` verts, au moins autant de tests qu'avant plus les nouveaux.
- `compose-characterization.test.ts.snap` inchangé entre le commit qui l'ajoute et la fin de la branche.
- `composeTurn` lisible d'un trait ; aucun fichier nouveau au-delà de ~300 lignes sauf les tables de consignes.

## Hors périmètre

- Changer une règle, une consigne, un ordre de vérification, un prix ou un délai, même un qui semble faux : il va dans « Découvertes ».
- `draft-composer.ts` (lui aussi long) : une autre fiche.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Résultat : `compose.ts` passe de plus de 2 200 lignes à 252 ; les étapes vivent dans `agent/domain/turn-*.ts` (pures, 47 tests) et `agent/infra/compose-*.ts` (préparation, cerveau, décision, commande perso, voix). L'instantané de caractérisation n'a pas bougé d'un octet.
- `decideTurn` reste un seul bloc de ~265 lignes : l'ordre de ses décisions compte, il appelle des fonctions nommées.
- Renommage : `GuardContext.fanTier` → `meetingTier` ; `close-only-words.test.ts` suit le nom de la clé, aucune attente changée.
- Découvertes (non corrigées) : voir `docs/sessions/log/2026-11-27-compose-split.md`.
