# 2026-10-29 — Recette design, finitions (dates, compteurs, créatrices) — done

Fait :
- PAIE-19 : le premier du mois s'écrit « 1er » dans chaque format de date, par `withFirstOfMonth` : `dayMonth` (« dim. 1er nov. »), le libellé de la semaine (« 26 oct. – 1er nov. »), `shortDay` (« dim. 1er », donc les conflits du Planning et la courbe du désir), la date d'une note interne (`noteDay`), la date du Dashboard, les dates de sauvegarde et d'essai de restauration (`testedDay`), la date d'un signalement et la date de création d'une fiche persona (`fullDay`). Seul le chiffre en tête de colonne de la grille du Planning reste « 1 », comme sur tout calendrier (`dayNumber`).
- PAIE-09 : le compteur d'un onglet (`nv-subnav__count`) est un nombre en encre sur verre, jamais une pastille néon ; le néon reste au bouton de l'écran. La prop `quiet` disparaît, tous les compteurs ont ce ton.
- CREA-30 : la liste des créatrices ne réessaie qu'une fois, après 400 ms ; « Le serveur ne répond pas » arrive en moins de deux secondes (les heures le faisaient déjà). Tous les lecteurs de `['creators']`, la pastille du mode comprise, partagent ces options (`creatorsQuery`) : la première rendue ne les remplace plus par trois réessais.
- CREA-27 : le fuseau d'une créatrice se choisit par ville (« Paris », « Toronto (Montréal) ») dans une liste, les villes courantes de l'agence d'abord, le fuseau gardé derrière ; à la création comme au changement de fuseau. Le texte d'un fuseau refusé dit « Choisis une ville dans la liste ». Un seul nom de ville partout (`cityOf`, en français : Bruxelles, Lomé…) : la liste, la Persona, l'en-tête des heures et le changement de fuseau, qui ne montre plus l'identifiant.
Déjà faits, vérifiés : PAIE-16 (fondu et défilement jusqu'à l'onglet actif au téléphone), DASH-22 à 25 (#316).
Décisions : Montréal et Genève n'ont pas de fuseau à elles, elles se lisent « Toronto (Montréal) » et « Zurich (Genève) » dans la liste, puis « Toronto » et « Zurich » partout, le nom du fuseau gardé ; un fuseau déjà posé hors de la liste reste proposé tel quel.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests web ✓ (« 1er » dans chaque format de date, un test par format, chiffre seul de la grille ; compteur neutre ; ville et fuseau derrière, un seul nom de ville ; fuseau refusé).
