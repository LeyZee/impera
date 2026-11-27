# 2026-11-27 · Coffre : une seule « ma journée » (recette du 27/11)

- **Fiche** : CR-17 (coffre), recette navigation du 27/11 (MOD-01, MOD-02, F3, MOD-06, MOD-10, MOD-11).
- **Fait** : Charles a répondu « elle dépose, Impera planifie ». La vidéo du jour de « Ma journée » est donc faite par le coffre, et ne se coche plus (avenant du 27/11 de l'ADR 0140, `source: 'drop'` dans le contrat). Le serveur la calcule d'une seule façon pour elle, pour son coffre et pour « Où elle en est » : une vidéo du feed arrivée ce jour-là, ou, pour aujourd'hui, une qui attend dans son coffre.
  - Le coffre de la modèle lit la même journée. Il ne dit plus « ta journée est bouclée » ; il parle de la semaine ou de son stock.
  - Les scripts ne lui sont réclamés que si l'agence en demande.
  - Le texte dit « trois prêts », et l'accord est corrigé : « 0 prêt sur 3 ».
  - « Déposer » ouvre la bonne feuille (`?depot=`).
  - Au téléphone, la barre de filtres de la tuile est masquée.
  - Les textes de la modèle sont tutoyés, et un anneau sans objectif est gris à 0.
- **Tests** : unitaires (domaine du jour, « Où elle en est », modèle du coffre, carte du jour) et intégration (`creator-week`, vidéos arrivées et en stock).
- **Découvertes** : MOD-03, MOD-04, MOD-05, MOD-07, MOD-09 et MOD-12 à MOD-15 ne relèvent pas du coffre et restent à prendre ailleurs.
