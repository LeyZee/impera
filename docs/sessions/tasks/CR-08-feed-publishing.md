# CR-08 Plan de publication du feed : la semaine préparée, acceptée d'un geste, programmée dans Reveal
Statut : blocked (capture Reveal : publication, programmation, visibilité, statistiques) (ADR 0044 § 3, § 4 et § 6, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0044)
Dépend de : CR-06, CR-07, la capture Reveal, le connecteur Reveal (lot A), la garde d'écriture (ADR 0018)
Branche : task/cr-08-feed-publishing

## Objectif
Chaque semaine, le code prépare au moins une publication par jour aux heures où les fans sont actifs, le LLM écrit les légendes, l'agence accepte d'un geste, et Nirvana téléverse et programme dans Reveal.

## Contexte à lire
`docs/adr/0044-content-drops-feed-and-mass-dm.md`, ADR 0018, 0003, `docs/architecture/connectors.md`, `docs/reference/fake-reveal.md`, les gardes de voix, `docs/reference/reveal-api-observed.md` après la capture.

## À faire
- [ ] Capacités facultatives du port (propriétaire de `packages/contracts` et du module `connectors`) : téléverser un média, publier ou programmer avec visibilité, lire les statistiques d'une publication ; d'abord dans `FakeReveal`.
- [ ] Plan pur : nombre par jour réglé (1 par défaut), heure tirée de l'activité des fans des semaines passées (20 h sans historique), dépôts les plus anciens d'abord, pas deux sortes identiques d'affilée, visibilité par défaut de la créatrice.
- [ ] Légende : prompt versionné, voix de la créatrice, gardes de voix, courte, cohérente avec la description, question ouverte ; schéma Zod.
- [ ] Écran : la semaine en une vue, « Tout accepter », modification d'une publication (contenu, légende, heure, visibilité) ; droit de regard de la créatrice.
- [ ] Envoi : clé d'idempotence par publication, garde d'écriture, échec en ambre avec sa raison, jamais de republication à l'aveugle.
- [ ] Mesure à 48 h contre la médiane de 30 jours ; les publications du quart du haut nourrissent le topo (CR-07).

## Critères d'acceptation
- Tests contre `FakeReveal` : double acceptation sans double publication, garde d'écriture fermée = rien ne part, échec de téléversement en ambre, plan sans historique à 20 h.
- Une publication de test réelle, sans risque, faite avec Charles.

## Hors périmètre
Publication sans acceptation humaine ; Mass DM (CR-11).

## Notes de session
- 03/11/2026 : l'ADR 0055 (proposée) ajoute la story Reveal au plan, et l'ADR 0057 (proposée) y ajoute Instagram et Telegram ; le plan devient multi-sorties, une sortie par catégorie.
