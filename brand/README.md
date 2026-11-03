# Marque Impera

Le logo est une flamme à l'auréole : une flamme pleine, cambrée, qui brûle sous un halo elliptique. Le tracé de la flamme a été dessiné par Charles le 16 octobre 2026 et n'est pas retouché. Deux corrections validées par lui le même soir : la flamme est devenue la source de lumière (cœur chaud en bas, rouge néon vers les bords, lueur autour) au lieu d'un verre translucide éclairé, et l'auréole est recentrée sur la pointe, moins inclinée (−12°).

![Lockups Nuit et Jour, symbole couleur, favicon et symbole mono](../docs/design/images/marque.png)

## Fichiers

| Fichier | Quoi | Quand |
| --- | --- | --- |
| `brand/impera-mark.svg` | Le symbole seul, en couleur (flamme lumineuse + auréole) | Partout où le symbole est affiché à 48 px ou plus : en-têtes, écrans de connexion, cartes |
| `brand/impera-mark-mono.svg` | Le symbole en une couleur (`currentColor`, néon par défaut) | Petites tailles, impression, incrustation sur photo, icône dans une barre d'outils |
| `brand/favicon.svg` | Le symbole mono avec une auréole épaissie, cadré serré | Favicon et icônes d'app (lisible dès 16 px) ; à copier dans `public/` des apps par la fiche qui les crée |
| `brand/impera-lockup.svg` | Symbole + nom « Impera » éclairé par la flamme, auréole à la place du point du i | Sur fond Nuit (`void`, `abyss`, verre) |
| `brand/impera-lockup-jour.svg` | Même lockup, nom plus foncé pour rester lisible | Sur fond Jour |
| `brand/impera-lockup-mono.svg` | Lockup en une couleur | Signatures, documents, partenaires |
| `brand/banner.svg` | La bannière du README (nuit, aura, lockup) | En-tête du README, pages d'accueil de dépôt |

Le nom dans les lockups est un tracé vectorisé de Playfair Display italique 600 (Google Fonts, licence OFL), pour que le rendu ne dépende pas d'une police installée (GitHub n'en charge aucune dans un SVG). Dans l'interface, le nom est du texte dans la même police (`.nv-wordmark`).

## Règles

- **Une seule version par contexte.** Couleur dès que la place le permet, mono en dessous de 48 px ou quand le fond est chargé. Ne pas mélanger les deux sur un même écran.
- **Zone de protection** : autour du symbole, laisser au moins la largeur de l'auréole libre de tout texte ou bord.
- **Ne pas** recolorer le dégradé, incliner ou étirer le symbole, séparer l'auréole de la flamme, ajouter un contour, un fond ou une ombre dure. Le mono se teinte par `color` (`currentColor`), jamais en éditant le fichier.
- **Taille minimale** : 24 px pour le mono, 48 px pour la couleur, 16 px pour `favicon.svg` uniquement.
- **Couleurs** : la flamme va d'un cœur chaud `#ffc2cc` à `#ff6b80`, puis `neon` `#ff2a4d`, `neon-solid` `#e0103a` et `#b8002a` vers les bords, avec une lueur `neon` floutée derrière ; l'auréole est un trait `#ff3659` / `#ffb0b9` / `#ff234c`. Le mono prend `neon` (`#ff2a4d`) sur Nuit, `#cc0029` sur Jour si le contraste l'exige.

## Déclinaisons et comment elles ont été faites

- `impera-mark.svg` : le tracé de Charles, dégradé radial (foyer vers le bas de la flamme), lueur par `feGaussianBlur`, reflet raccourci près de la pointe, auréole centrée sur la pointe ; cadré au carré avec la marge de la lueur ; identifiants préfixés `nv-`, `<title>` et `aria-label` ajoutés.
- `impera-mark-mono.svg` et `favicon.svg` : même flamme en aplat `currentColor`, auréole en trait plein (10 puis 22 d'épaisseur), sans reflet.
- Lockups et bannière : symbole à 150 de haut, nom en Playfair Display italique 600 avec une hauteur de capitale de 82, centrée sur le corps de la flamme, à 24 de la flamme mesurés depuis la boucle du N ; glyphes vectorisés avec fontTools + HarfBuzz (crénage inclus). Le point du i est remplacé par une petite auréole inclinée comme celle du symbole. Le nom est éclairé par la flamme : dégradé radial dont le foyer est juste à gauche du N (`#ffc2cc`, `#ff6b80`, `neon`, puis `#d40a35` au bout du mot ; sur Jour `#ff4661` à `#a80026`), avec la même lueur `neon` floutée que la flamme. Rien à régénérer en routine : pour modifier le nom ou l'espacement, repartir du `.ttf` de Google Fonts avec les mêmes outils.
