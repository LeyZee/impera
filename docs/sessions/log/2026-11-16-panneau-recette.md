# 2026-11-16 — Le panneau copilote se lit en trois secondes et ne propose rien pour un fan à ne plus écrire (recette EXT-04 à EXT-23) — fait

**Session** : Extension et playground · **Branche** : `claude/extension-reveal-playground-45axcj`

Fait : corrections du panneau copilote relevées par la recette du 16/11.
- EXT-04 : prénom, âge et ville tiennent sur une ligne (« Marc · 34 ans · Lyon »), leur source dite une fois ; chaque autre case prend deux lignes, la source en petit à droite du libellé, pas répétée quand c'est la même ; le brouillon ne dépasse plus deux cinquièmes du panneau et ses bulles défilent seules.
- EXT-05 (côté panneau) : pour un fan « Ne plus lui écrire », ni « Copier » ni « Retoucher » (ni les touches A et E) ; une ligne rouge dit pourquoi et ne laisse que « Refuser ». Les autres arrêts (ventes gelées, âge contesté) interdisent une offre, pas un mot : leurs gestes restent.
- EXT-13 : « Envoyer » devient « Copier pour Reveal » ; plusieurs bulles se copient une à une (« Bulle 1 sur 3 copiée », « Copier la bulle 2 », A), le geste compté une fois.
- EXT-14 : le pseudo du fan en tête du panneau, dans une bande qui ne défile pas ; une valeur notée après la première lecture de la fiche porte « nouveau ».
- EXT-15 : l'âge des valeurs suit l'horloge, à la minute.
- EXT-16 : le focus clavier revient sur le contrôle qui l'avait (groupe, geste, raison, note) quand la fiche se redessine.
- EXT-17 : à qui n'a pas Créatrices, la fiche éteinte dit « Demande à ton manager de l'allumer ».
- EXT-20 : le champ retouché grandit avec le texte, jusqu'à dix lignes.
- EXT-21 : le geste principal sur sa ligne, les deux autres côte à côte, boutons de 40 px : rien ne passe seul à la ligne à 320 px.
- EXT-23 : « Refusé… » ou « Texte copié… » reste 30 s après le départ du brouillon, et tant qu'il reste des bulles à copier.
Pas fait : le nom de la créatrice en tête (EXT-14) et le panneau hors shift avec son nom et l'heure du prochain shift (EXT-27) demandent que l'API les donne : PR côté serveur. Le refus du geste par le serveur (EXT-05) aussi. La tête lue chez Reveal et la phase (ADR 0086 § 3) attendent des données que l'API n'a pas.
Décisions : seul « Ne plus lui écrire » retire les gestes de copie (les autres arrêts interdisent une offre, pas un message) ; le mot « nouveau » en encre, ni rouge ni ambre.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests du panneau, de la fiche, de la ligne « où on en est » et du redessin (chacun échoue sans sa correction), pnpm check, pnpm test (pre-push) ; écrans vus à 320 et 400 px, Nuit et Jour, extension chargée dans Chromium avec un CRM simulé.
