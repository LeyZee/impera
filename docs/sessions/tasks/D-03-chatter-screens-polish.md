# D-03 Peaufiner les écrans du chatteur

Statut : in_progress
Phase : 4
Dépend de : D-01, D-02
Branche : claude/project-thread-xxi5nz (un commit par lot, une PR)

## Objectif
Demande de Charles du 05/11/2026 : sur chaque écran du chatteur, une hiérarchie nette, rien d'inutile, un geste évident. Audit avec captures avant (Nuit, Jour, téléphone, ordinateur), liste CH-01 à CH-19 validée par « ok liste », puis « applique tout ce que ton audit a révélé ». Liste (hors dépôt) : https://claude.ai/artifact/ELkGzbcz48FhSvJwAWxjHf.

## Contexte à lire
`docs/design/README.md`, `packages/design-system`, ADR 0024 (rails par rôle), ADR 0066 (menus partagés), `docs/glossary.md`.

## Fait
- Lot a, Aujourd'hui : un seul « À faire » (rapports, factures à accepter, textes et pièces du dossier), le chemin vers Suivi avec le nombre à traiter, les urgences en rouge seulement.
- Lot b, Suivi (liste) : le rouge réservé aux urgences, le pseudo du fan d'abord avec ses non-lus, la cause à côté de l'action, la bande de désir en mots et emoji.
- Lot c, conversation : bulles envoyées en gris chaud (`--nv-bubble-sent`), brouillon en contour neutre, « Automatique » sous les messages de l'agent, la fiche du fan dans l'en-tête, `--nv-fill-soft` pour les fonds doux lisibles en Jour.
- Lot d : Moi › Préférences (apparence, notifications, déconnexion) remplace « Plus » sur la barre du téléphone quand tous les onglets y tiennent (`railOf().phoneMenu`) ; « Demander un congé » dans « Mes congés » ; Commissions ne répète plus la quinzaine du héros ; Dossier aligné sur le padding du panneau.

## Reste
- Captures après, Nuit et Jour, et « ok captures » de Charles avant fusion.
- Relecture croisée par Extension (propriétaire d'apps/web et du design system).

## Critères d'acceptation
- Jetons et classes `nv-*` seulement, rouge réservé aux urgences, ambre aux avertissements, aucune barre colorée sur le côté d'une carte.
- Le chatteur ne voit jamais le pourcentage de l'agence.
- `pnpm check` et `pnpm test` verts.

## Hors périmètre
Écrans créatrice (fils Chantier 7 et Bilan), tout changement d'API.
