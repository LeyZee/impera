# 2026-11-05 — CRM-07 b2 : le nombre de nouvelles créatrices, et ce qui reste pour elle — done

Fait : l'onglet Réglages › Ventes porte le nombre de modèles que Reveal listait à sa dernière lecture, sans lien ni écartées (`GET /v1/settings/sales-feeds/new-models`, #545). Le chiffre est dit en toutes lettres au survol et au lecteur d'écran (« 3 nouvelles créatrices sur Reveal », ADR 0069 § 5) ; le compte est relu à chaque lecture du bloc d'import, si bien qu'un import ou une créatrice écartée le fait baisser. `SubNav` prend un `countLabel` facultatif pour cela.
Fait aussi : sur la fiche d'une créatrice, la carte « Pour démarrer avec … » (propriétaire seul) liste ce qui reste : sa persona, le pourcentage de l'agence, son accès, chacun avec « Ouvrir » vers son onglet, et son fuseau en pied de carte. Elle n'apparaît qu'une fois les trois lectures faites, et disparaît quand tout est fait. Les cases de l'import (et des rapports, de la paie) passent par une case du design system, `nv-check` : carré doux rempli d'encre, coche dessinée, cible de 44px (retour de Charles sur les captures, 05/11) ; `.rp-check` et `.sf-imp__pick` disparaissent.
Pas fait : rien de la fiche.
Décisions : la carte vaut pour toute créatrice incomplète, importée ou non ; le fuseau n'est pas une étape (il a toujours une valeur). Le compte suit la liste d'import, tout statut compris (Bilan, 05/11) ; une erreur ou une attente laisse l'onglet nu, jamais un chiffre faux ; pas de nombre dans la barre du téléphone ni dans « Plus » (ADR : « dans Réglages »).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `SettingsLayout.test.tsx`, `importing.test.ts`, `setup.test.ts`, `CreatorsPage.test.tsx` (9 nouveaux) ; captures Nuit et Jour, ordinateur et téléphone, hors dépôt (`reglages-ventes/crm-07b2/`).
