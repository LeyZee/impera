# 0064. Cartons de script : la couleur du script et le dessin d'OnlyScript

Statut : proposed (demande de Charles du 03/11/2026, 12 h 42 et 12 h 43, fil « Médias et scripts » : « Il faut vraiment que tu reprennes les cartons de OnlyScript. Ils étaient bien parce qu'ils étaient colorés […] chaque script a son code couleur. Ça permettait de les retrouver facilement et de ne pas se perdre » ; « le choix des couleurs […] le choix des étapes, d'ajouter des étapes ou non, […] de modifier ce qu'il y a sur les cartons […] il faut absolument l'avoir »)
Date : 2026-11-03
Remplace : dans l'ADR 0056 § 3, la phrase « La palette vient des jetons du design system, pas d'une couleur libre ; la typographie est celle de Nirvana. »
Précise : l'ADR 0056 § 1 (un pont peut porter des emplacements ; une étape dit si elle est offerte ou payante) et § 3 (ce que dit un carton).
L'ADR 0056 reste telle quelle pour tout le reste ; l'index des ADR renvoie d'elle à celle-ci.

## Contexte

L'ADR 0056 § 3 dessinait les cartons avec la palette du design system : clair pour un script de jour, sombre pour un script de nuit. Le lot b de SC-01 (#477) l'a fait, et Charles a vu les rendus le 03/11. Il veut les cartons d'OnlyScript, son ancien outil.

Dans OnlyScript, chaque script avait sa couleur, un aplat ou un dégradé de trois tons, sur toute la surface du carton. Dans un dossier, dans le coffre Reveal ou dans l'écran des chatteurs, on reconnaît un script à sa couleur sans lire son nom. Avec deux palettes seulement, tous les scripts de nuit se ressemblent. Le reste du dessin d'OnlyScript lui convenait :
- « ETAPE 2 » en grand et centré, le nom de l'étape dessous ;
- ce que l'étape vend entre guillemets, avec « (GRATUIT) » ou « (PAYANT) » ;
- ce qu'il faut tourner ;
- les séries A, B et C en pied du carton de l'étape, et un carton par série avec une flèche ;
- une arche pour un pont, qui porte aussi sa photo teasing.

## Décision

### 1. La couleur du script

- Chaque version de structure porte une **couleur** : trois tons (`primary`, `secondary`, `accent`) en hexadécimal. Un aplat, ce sont trois tons proches.
- L'atelier propose des palettes nommées (une couleur unie ou un dégradé, comme dans OnlyScript) et un choix libre. La couleur est une donnée de la structure : changer de couleur suit la règle 6 (une version figée ne change pas).
- Le carton prend le dégradé sur toute sa surface. **Le code choisit la couleur du texte**, clair ou foncé, celle qui contraste le mieux avec le dégradé. Le texte est écrit dans cette couleur pleine, sans transparence. Un dégradé où aucune des deux n'atteint 4,5:1 sur chaque ton et sur les mélanges entre deux tons est refusé à l'enregistrement, avec un message qui le dit.
- Une version écrite sans couleur, ou avant cette ADR, prend la palette « Rouge ».
- Le moment reste écrit sur le carton, en petit, avec son icône : un soleil pour Jour, une lune pour Nuit, un soleil et une lune pour un script qui passe partout (Jour et Nuit). Il ne change plus la palette.

### 2. Le dessin

- Repris d'OnlyScript, dans la typographie de Nirvana : Geist pour « ÉTAPE n » et le corps, Instrument Serif pour le nom de l'étape.
- **Étape** :
  - « ÉTAPE n » ;
  - son nom ;
  - son intention entre guillemets, avec « (GRATUIT) » ou « (PAYANT) » ;
  - ce qu'il faut tourner ;
  - les indications par emplacement (trois au moins quand il y en a) ;
  - l'ambiance ;
  - avec des variantes, une pastille par série en pied (« Série A », « Série B »…).
- **Série** (le carton d'une variante) : « ÉTAPE n », « Série A », sa consigne, et en pied les pastilles des séries de l'étape, la sienne pleine.
- **Pont** : « Pont n & m », son teaser entre guillemets avec « (GRATUIT) », ce qu'il faut tourner, et en pied les noms des deux étapes qu'il relie, dans deux pastilles jointes par une arche en pointillé.
- Les icônes et les pastilles suivent les icônes au trait du design system (grille de 24, trait de 2, bouts ronds). La flèche et l'arche pleines d'OnlyScript ne sont pas reprises (Charles, 03/11/2026, 13 h 15).
- Sur un carton, une variante s'appelle « Série », comme dans OnlyScript. Le code garde `variant` (glossaire).
- Aucun bruit à l'écran ni dans le fichier : pas d'empreinte visible, pas de filigrane. Un nom de fichier (ADR 0056 § 5) et la médiathèque suffisent à reconnaître un carton.

### 3. Ce que la structure gagne

- **Une étape dit si elle est offerte ou payante** (`access` : `free` ou `paid`). C'est ce que le carton écrit, et rien d'autre : le prix reste à P6-01, et l'agent ne lit jamais ce champ.
- Une étape écrite avant cette ADR est **payante** (`paid`) : la migration 0095 le lui donne si sa version n'est pas encore figée, et une version figée est lue avec cette valeur sans être réécrite (règle 6).
- **Un pont peut porter des emplacements** (trois au plus, souvent une photo teasing). Il reste offert : le carton d'un pont dit toujours « (GRATUIT) ». Un pont écrit avant cette ADR n'en porte aucun.
- Les indications des emplacements d'un pont sont tournées : elles passent contre ce qu'elle ne fait jamais, ne montre jamais et ce qui la dégoûte, comme celles d'une étape. Son teaser reste lu contre ce qu'elle ne dit jamais et ce qui la dégoûte.

### 4. Les structures de départ

La structure de départ de l'agence est livrée dans le dépôt, avec ses noms d'étapes tels qu'OnlyScript les portait (choix de Charles, 03/11/2026, 12 h 51, sur la question « Où mettre ta structure de départ […], le dépôt étant public ? ») :
- Teasing, en trois séries A, B et C, offert ;
- Seins, Chatte, Masturbation, Jeux God, Pénétration et Orgasme, payants ;
- un pont offert entre deux étapes, de « Pont 2 & 3 » à « Pont 5 & 6 », avec sa photo teasing.

C'est une méthode de l'agence, pas une donnée de fan ni de créatrice : l'ADR 0010 ne l'interdit pas. Ce qui reste interdit dans le dépôt, c'est une persona réelle ou un média réel. L'agence la duplique et l'ajuste dans l'atelier.

## Conséquences

- Positives : on retrouve un script à sa couleur ; les cartons ressemblent à ceux que l'agence et les créatrices connaissent ; le texte reste lisible quelle que soit la couleur choisie, parce que le code le vérifie.
- Négatives : une colonne `color` sur les versions de structure (migration 0095) ; le carton ne suit plus les thèmes de l'application ; la méthode de vente de l'agence (ses étapes) est lisible dans le dépôt public, par choix de Charles.
- À surveiller : deux scripts de même structure et de même couleur donnent des cartons identiques. Si Reveal refuse un fichier déjà téléversé, le numéro du script (`S014`, ADR 0056 § 5) entre dans le carton (SC-03).

## Alternatives rejetées

- **Garder Jour et Nuit des jetons** : c'est le dessin que Charles a refusé, parce que tous les scripts d'un même moment se ressemblent.
- **Couleur libre sans contrôle** : un jaune pâle sous un texte blanc ne se lit pas ; le contrôle du contraste coûte une fonction pure.
- **Un léger décalage de couleur par script, comme le faisait OnlyScript pour éviter les doublons sur OnlyFans** : le rendu ne serait plus déterministe, pour un risque que Reveal n'a pas montré.
