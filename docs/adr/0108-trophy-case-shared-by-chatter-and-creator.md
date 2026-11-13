# 0108. Une vitrine des trophées commune au chatteur et à la créatrice

Statut : accepted (« ok 0108 » de Charles le 13/11/2026, 2 h 40 heure de Paris ; demande de Charles du 13/11/2026, 2 h 37 et 2 h 38 heure de Paris ; numéro attribué par le coordinateur le 13/11)
Date : 2026-11-13
Précise : l'ADR 0104 § B (le jeu du chatteur), l'ADR 0107 § C (« Mes trophées » de la créatrice, § 10). Reprend leurs limites telles quelles. Ne remplace rien.

## Contexte

Le chatteur gagne des médailles de palier, des séries et des trophées (ADR 0104) ; la créatrice gagne des médailles de série et des trophées (ADR 0107). Les objets et le dévoilement animé sont dessinés et validés par Charles (planche 7 des médailles, planches des trophées de la créatrice). Il manque l'endroit où l'on voit tout d'un coup : ce qu'on a gagné, ce qui reste, et où l'on en est du prochain.

Charles veut cet endroit « comme les récompenses de l'application Forme d'Apple », très beau, animé, avec de beaux survols et une hiérarchie claire, pour les deux rôles. On en reprend le principe (tout montrer, gagné ou non, et l'avancement), pas l'apparence : le langage graphique reste celui d'Impera.

« Vitrine » désigne déjà dans le glossaire la page de démonstration du design system (`showcase`). L'écran s'appelle donc « Mes trophées » et le terme de code est `trophy_case` (« vitrine des trophées »).

## Décision

### A. Ce qu'elle montre

1. **Un seul écran, deux rôles.** « Mes trophées », dans Moi, pour le chatteur et la créatrice. Même composant, posé sur les données de chacun. On y arrive aussi depuis la carte des trophées de Commissions (chatteur) et depuis la série à côté de sa journée (créatrice).
2. **Tout, gagné ou non.** Chaque objet de la liste fermée du rôle apparaît : gagné, en couleur avec sa date ; pas encore gagné, en silhouette avec une ligne qui dit comment le gagner. Le nom est toujours écrit à côté de l'objet.
3. **En tête, le prochain trophée.** Une seule carte en haut : l'objet pas encore gagné le plus avancé, en grand, entouré de son anneau d'avancement et de son pourcentage, avec « encore N … ». Sous elle, une ligne de chiffres : objets gagnés sur le total, la série en cours et la meilleure. Le chatteur y voit aussi son niveau (ADR 0104 § 16) ; la créatrice n'a pas de niveau (ADR 0107 § 4).
4. **Puis trois étagères, toujours dans cet ordre** : médailles (paliers du chatteur, paliers de série de la créatrice), séries (shifts tenus pour le chatteur, livraisons à l'heure pour la créatrice), trophées. Dans chaque étagère, les gagnés d'abord, du plus récent au plus ancien, puis les silhouettes du plus avancé au moins avancé.
5. **Le détail d'un objet.** Un clic ou un toucher ouvre l'objet en grand : nom, date ou condition, avancement s'il y en a, et pour un objet gagné un bouton « Revoir » qui rejoue son dévoilement.

### B. L'avancement

6. **Seulement sur un compte réel.** Un pourcentage n'existe que quand le trophée se gagne en atteignant un nombre : séries de shifts (5, 10, 25), paliers de commission (la même part du chemin que l'anneau de Commissions, lue dans le relevé), médailles de série de la créatrice (7 à 100 jours), livraisons à l'heure (5, 10, 25), Stock plein (catégories au-dessus du seuil sur catégories actives). Les trophées qui se gagnent d'un coup (première vente, record battu, quinzaine à l'heure, dix PPV dans un shift, premier dépôt, journée parfaite, premier script, contenu qui a cartonné) n'ont pas de pourcentage, seulement leur ligne « comment le gagner ».
7. **Arrondi vers le bas, jamais 100 % avant le gain.** 9 shifts sur 10 s'affichent 90 % ; un objet n'atteint 100 % qu'une fois gagné.
8. **Calculé par le serveur, jamais par l'écran.** Chaque rôle a une route qui renvoie ses objets sous une forme commune, décrite dans `packages/contracts/src/trophy-case.ts` (Zod) : le trophée (`kind`), son étagère (`family` : `medal`, `streak`, `trophy`), sa date de gain ou rien, son avancement (actuel, cible, unité) ou rien, la date de son dévoilement vu ; plus les séries (en cours, meilleure) et le niveau du chatteur. La phrase « comment le gagner » est un texte d'interface, écrit côté écran pour chaque trophée. La vitrine ne fait qu'afficher. Elle lit les tables des ADR 0104 et 0107 ; elle n'en ajoute aucune.
9. **Une série cassée ne se montre pas comme une perte.** L'avancement repart du compte en cours, en encre neutre, et la meilleure série reste affichée. Jamais de rouge, jamais « perdu ».

### C. Le mouvement

10. **À l'ouverture.** Les objets entrent en cascade, étagère par étagère, l'anneau du prochain trophée se remplit jusqu'à son pourcentage, puis un reflet passe une fois sur les objets gagnés. Le tout dure moins d'une seconde et demie et ne se rejoue pas en revenant sur l'écran dans la même session.
11. **Au survol (souris) et au toucher.** L'objet se soulève légèrement, sa lueur s'avive et il s'incline vers le pointeur, comme une pièce sous une lampe ; le nom et la date restent lisibles sans survol.
12. **Le dévoilement est celui des ADR 0104 et 0107**, sans changer son dessin ni son mouvement. Un gain pas encore vu porte une pastille « Nouveau » dans la vitrine ; l'ouvrir joue son dévoilement et le marque vu.
13. **Le son** : seulement dans le dévoilement, selon la préférence « Sons » du compte. La vitrine elle-même est silencieuse.
14. **« Réduire les animations »** : tout est immobile, les anneaux sont dessinés à leur valeur, le dévoilement montre son image finale. Aucune information n'existe seulement dans une animation.

### D. Ce qu'elle ne fait jamais

15. **Aucun effet sur l'argent.** La vitrine affiche, elle ne calcule ni prime, ni taux, ni part. Le seul montant possible est le « encore X € de net » du palier du chatteur, lu dans son relevé comme sur Commissions. La créatrice n'y voit aucun montant.
16. **Pas de comparaison.** Ni classement, ni moyenne de l'équipe, ni « X % des chatteurs ont ce trophée ». Un chatteur ne voit jamais la vitrine d'un autre ni celle d'une créatrice.
17. **Pas de hasard, pas de rappel.** Aucune récompense tirée au hasard, aucune notification ni message pour faire revenir vers la vitrine, aucun compte à rebours.
18. **Compris d'un coup d'œil pour la créatrice** : trois étagères, des noms en clair, pas de jargon, pas de niveau.
19. **L'agence** (propriétaire, manager actif) voit la vitrine d'un membre ou d'une créatrice sur sa fiche, en lecture, sans animation d'entrée et sans « Revoir ».

### E. Comment c'est fait

20. **Après les PR des objets.** La PR de la vitrine part après celle des médailles du chatteur, le lot 2 du chatteur (ADR 0104, migration 0178) et celle des trophées de la créatrice (ADR 0107, migration 0181). Chacune de ces PR fournit sa route sous la forme commune ; la vitrine les assemble. Pas de migration pour la vitrine.
21. **Captures avant fusion** : Nuit et Jour, PC et téléphone, données inventées, et une vidéo des animations que Charles juge lui-même.

## Conséquences

- Positives : un seul endroit où chacun voit ce qu'il a construit ; un seul composant pour deux rôles ; aucune donnée ni table nouvelle.
- Négatives : la forme commune lie trois PR ; la vitrine attend que les deux autres soient fusionnées.
- À surveiller : si une étagère est presque vide pour un nouveau venu, la page paraît triste ; les silhouettes et le prochain trophée en tête sont là pour ça.

## Alternatives rejetées

- **Une vitrine par rôle** : deux écrans à tenir pour la même chose.
- **Copier l'apparence de Forme** (médailles en métal 3D sur fond noir, grille de cercles) : ce n'est ni notre marque ni nos objets.
- **Un pourcentage pour tout trophée** (par exemple « ton meilleur shift : 7 PPV sur 10 ») : invente une progression là où le fait est d'un coup, et pousse à forcer un shift.
- **Montrer combien de collègues ont un trophée** : comparaison déguisée, contraire à 0043 § 7.
