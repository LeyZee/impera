# PROPOSED — Vitrine des trophées (« Mes trophées »)

Statut : proposed (ADR 0108 acceptée ; code après les PR des médailles, du jeu du chatteur et des trophées de la créatrice)
Branche : `claude/project-thread-6cim3j`
ADR : 0108 (précise 0104 § B et 0107 § C)

## But

Un seul écran « Mes trophées », dans Moi, pour le chatteur et la créatrice : le prochain trophée en tête avec son anneau d'avancement, puis trois étagères (médailles, séries, trophées), le détail d'un objet et « Revoir » son dévoilement.

## Dépendances

- `packages/contracts/src/trophy-case.ts` (`TrophyCase`, `TrophyCaseItem`), posé par la première des deux PR suivantes à fusionner, relu par Bilan.
- Route du chatteur (lot 2 de CHF-01, migration 0178) et route de la créatrice (ADR 0107, migration 0181) qui renvoient cette forme.
- Composants `Medal`, `TrophyBadge`, `RewardReveal` (`apps/web/src/rewards/`, PR des médailles).

## À faire

1. Composant `TrophyCase` (en-tête « prochain trophée », ligne de chiffres, trois étagères, détail, « Revoir »), lecture seule pour la fiche d'un membre ou d'une créatrice.
2. Textes « comment le gagner » par `kind`, en français, côté écran.
3. Animations (cascade, anneau, reflet, survol incliné) avec les aides du design system ; tout immobile en mouvement réduit.
4. Tests : ordre des étagères, prochain trophée, arrondi vers le bas (jamais 100 % avant le gain), lecture seule sans « Revoir ».
5. Captures Nuit/Jour, PC/téléphone, vidéo des animations, avant fusion.

## Résultat

(à remplir)
