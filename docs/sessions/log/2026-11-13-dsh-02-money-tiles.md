# 2026-11-13 — DSH-02 L'argent sur des tuiles séparées, et la TVA des virements — review
Fait : ADR 0106 acceptée (« ok 0106 », 13/11 0 h 52) ; HT et TVA des virements estimée dans le contrat des insights ; tuiles Net, Part de l'agence, Part de la/des créatrice(s), TVA en plus sur les virements ; carte « Où va l'argent » ; glossaire.
Pas fait : captures de recette (à montrer avant fusion).
Décisions : ADR 0106 (taux de 20 % dans le code, parts en pourcentage du net), amendée § 10 à § 14 (couleurs par destination, tokens `--nv-money-creator` et `--nv-money-agency` validés au validateur dataviz, bulles au centime ; un second appui sur le même élément ferme la bulle, dans `useFloatingTip`).
Découvertes : l’API de Reveal n’a aucune route de virement ; le montant exact de la TVA ajoutée n’est lisible que sur le relevé de virement. En Jour, l’olive de `--nv-series-4` et l’or de `--nv-data-2` (« Qui vend ») ne sont qu’à 6,8 ΔE l’un de l’autre (validateur dataviz), avant cette PR : pour le fil Design.
Candidats à suppression : aucun.
Vérifié : voir la PR.
