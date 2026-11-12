# 0104. Le chatteur voit ses propres chiffres, et un jeu fait de faits réels l'accompagne

Statut : accepted (« ok 0104 » de Charles le 13/11/2026, 0 h 36 ; demande de Charles du 12/11/2026, 23 h 29 ; « applique toutes tes propositions et toutes tes recommandations », 13/11/2026, 0 h 33 ; numéro attribué par le coordinateur le 13/11)
Date : 2026-11-13
Précise : l'ADR 0043 § 7 (un chatteur ne voit jamais les chiffres d'un autre ni un classement), l'ADR 0050 § 10 (« Mes ventes lues »), l'ADR 0092 § 1 (valeur d'un chatteur, PPV envoyés et achetés). Ne remplace rien.

## Contexte

Charles veut que le chatteur retrouve, avec ses chiffres à lui, le style du Dashboard de l'agence (graphiques, donuts, animations, survols), et que l'écran soit vivant « comme un jeu » pour lui donner envie de bien travailler.

Aujourd'hui le chatteur a : « Aujourd'hui » (son shift, ses rapports, le shift suivant) et Commissions (ce qu'il touche, le parcours de son argent, son prochain palier, l'objectif de l'équipe en pourcentage, ses ventes lues jour par jour). Il n'a aucun graphique, aucune comparaison avec lui-même, aucun retour quand il progresse.

Un chatteur payé à la commission regarde trois choses : ce qu'il a gagné, ce qui lui manque pour le palier suivant, et s'il progresse. Un jeu ne tient que s'il raconte ces faits-là. Des points inventés se voient tout de suite et se retournent contre l'outil.

## Décision

### A. Ses chiffres

1. **Seulement les siens.** Chaque carte lit le relevé et les signalements du membre (comme « Mes ventes lues »), jamais le registre de l'agence. Aucun classement, aucune moyenne de l'équipe, aucune part de l'agence, aucun pseudo de fan. Chaque route nouvelle entre au harnais d'isolation avec un test « un chatteur ne lit pas un autre ».
2. **Où.** « Aujourd'hui » reste l'écran du shift : il gagne une seule carte compacte, « Ma quinzaine », sous le shift. Le détail vit dans Commissions, sous « Ma performance ». Une carte par sujet.
3. **Ma quinzaine.** Son gain estimé de la quinzaine en cours (sa commission, pas le chiffre d'affaires), des barres par jour, et l'écart avec sa quinzaine précédente arrêtée au même jour. Une quinzaine sans précédente ne montre pas d'écart.
4. **Prochain palier.** Un anneau : part du chemin faite, « encore X € de net ». Sans palier réglé, la carte ne s'affiche pas.
5. **Quand je vends.** Sa carte jour × heure, sur les 8 dernières semaines, dans son fuseau.
6. **D'où vient mon argent.** Un donut par type de vente. Le type entre dans la ligne de relevé du membre (lecture seule, pas de montant nouveau).
7. **Mes PPV.** Envoyés, achetés, taux d'achat, comparés à sa période précédente. Lus dans les chiffres de l'ADR 0092 § 1 ; « pas encore compté » tant qu'ils manquent, jamais zéro.
8. **Mes records.** Meilleur jour, meilleure quinzaine, avec leur date.
9. **Pas de conclusion sur trop peu.** Sous 30 ventes sur la période, une carte de répartition (5, 6) dit « Pas encore assez de ventes » (règle de 0092 § 5).
10. **Jamais de rouge pour une baisse.** Un écart négatif s'écrit en encre neutre. Le rouge reste aux urgences.
11. **Pas montré au chatteur.** Son chiffre par heure en poste (il reste chez le propriétaire et le manager, 0092 § 1) et son nombre de messages comme score.

### B. Le jeu

12. **Palier vivant.** Quand une vente lue arrive, la barre du palier avance avec une animation. Le palier atteint se fête une fois, à la première ouverture qui le constate.
13. **Série.** Le nombre de shifts tenus d'affilée avec leur rapport rendu à l'heure. Elle se compte sur ses shifts prévus : un repos, un échange accepté ou un shift annulé par l'agence ne la cassent pas. Un rapport en retard la remet à zéro ; sa meilleure série reste affichée.
14. **Défi du shift.** Un seul par shift, calculé par le code depuis son propre historique (la médiane de ses ventes nettes sur le même jour de semaine et le même créneau, sur 8 semaines). Sans assez d'historique (moins de 4 shifts comparables), pas de défi. Réussi ou non, il n'a aucun effet sur la paie.
15. **Trophées.** Une liste fermée, écrite dans le code, chacun lié à un fait vérifiable : première vente, record du jour battu, record de quinzaine battu, palier atteint, quinzaine sans rapport en retard, séries de 5, 10 et 25 shifts, dix PPV achetés dans un shift (quand 0092 § 1 les donne). Un trophée gagné ne se perd pas, même si une vente est ensuite remboursée.
16. **Niveaux.** Un rang qui monte avec son net cumulé depuis son arrivée et ne redescend jamais. Purement honorifique : il ne change ni le taux, ni un palier, ni un droit. Les seuils sont un réglage du propriétaire.
17. **Aucun effet sur l'argent.** Rien de B n'entre dans le calcul d'un relevé. Une prime réelle passe par Paie (bonus, paliers, objectif), jamais par le jeu.
18. **Ce que le jeu ne fait jamais.** Pas de récompense tirée au hasard. Pas de notification pour faire revenir hors shift. Pas de compte à rebours qui menace une série en dehors d'un shift. Pas de points pour des messages envoyés. Pas de comparaison avec un collègue.
19. **Mouvement.** Les animations suivent les aides du design system et s'éteignent avec « réduire les animations ». Aucune information n'existe seulement dans une animation.
20. **Le manager et le propriétaire** ne jouent pas : ils voient la série et les trophées d'un membre sur sa fiche, en lecture.

### C. Les chatteurs payés à l'heure

21. La paie ne connaît aujourd'hui que la commission. La carte « heures faites et rapports à l'heure » attend qu'un régime horaire existe ; elle n'est pas codée avant.

## Conséquences

- Positives : le chatteur voit où il en est sans demander ; le jeu récompense la régularité (rapports) autant que la vente.
- Négatives : une table nouvelle pour les trophées gagnés, les défis de shift et les seuils de niveaux (migration, FORCE RLS) ; un job qui constate trophées et défis à la clôture d'un shift, rejouable.
- À surveiller : un défi trop dur décourage. Si moins d'un défi sur trois est réussi sur un mois, le calcul passe de la médiane au premier quartile.

## Alternatives rejetées

- Recopier le Dashboard de l'agence pour le chatteur : il répond aux questions d'un directeur, pas aux siennes.
- Un classement, même anonyme : contraire à 0043 § 7, et transparent à trois personnes.
- Des points d'expérience par action (message, connexion) : pousse au spam et ne vaut rien à ses yeux.
- Coffres et récompenses au hasard : mécanique de dépendance, sans rapport avec son travail.
