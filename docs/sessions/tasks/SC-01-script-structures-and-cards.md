# SC-01 Structures de script et cartons : l'atelier de l'agence
Statut : blocked (ADR 0056 à accepter : « ok 0056 »)
Phase : scripts (ADR 0056)
Dépend de : ADR 0056, la persona (dégoûts), le design system
Branche : task/sc-01-script-structures

## Objectif
L'agence crée, duplique, réordonne et versionne ses structures de script, voit le carton de chaque segment en direct, et range pour chaque créatrice la file des structures à demander.

## Contexte à lire
`docs/adr/0056-scripts-shot-by-the-creator-with-cards.md` (§ 1 à 3), `docs/reference/legacy-projects.md` (§ OnlyScript, concepts seulement), `docs/glossary.md` (Structure, Carton, Étape, Pont, Emplacement, Variante), `docs/design/README.md`, `packages/design-system`, `personas/` (dégoûts).

## À faire
- [ ] Contrats (propriétaire de `packages/contracts`) : structure, version, segment (`stage` | `bridge`), emplacement (`media_slot` : `image` | `video` | `audio`, durées), variante (A, B, C), moment.
- [ ] Base (propriétaire de `packages/db`) : structures et versions immuables, file de structures par créatrice ; RLS par agence, lecture créatrice limitée aux versions qui lui sont demandées.
- [ ] Domaine pur et testé : les six règles de l'ADR 0056 § 1 (clé stable, numéro dérivé, ponts par clé, étape sans emplacement refusée, trois variantes au plus, version figée dès qu'elle est demandée) ; filtre des dégoûts de la persona.
- [ ] Rendu des cartons côté serveur : palette tirée des jetons, typographie Nirvana ; trois formats (carte, PNG du dossier, vignette) ; même entrée = même image (test d'instantané).
- [ ] Écran Créatrices › Structures (Extension) : pile à réordonner au glisser, aperçu du carton en direct, duplication, structures de départ, refus lisible d'une étape qui touche un dégoût ; file de structures par créatrice.
- [ ] Relecture Extension : pile réordonnable aussi au clavier ; un pont ne relie que deux étapes voisines ; carton PNG à plat (sans effet de verre), thème selon le moment (Jour clair, Nuit sombre).

## Critères d'acceptation
- Tests du domaine pour chaque règle ; une version demandée ne se modifie plus (nouvelle version créée).
- Écran : Nuit et Jour, 1 440 et 400 px, mouvement réduit.
- Aucune vraie persona ni vraie structure de l'agence dans le dépôt : exemples inventés.

## Hors périmètre
La demande de script et le dépôt (SC-02), les textes (SC-05), les prix (P6-01).

## Notes de session
