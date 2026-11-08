# 0082. Veille et Instagram : la médiane du compte, ce que le fil montre avant « … plus », la fiche reel

Statut : accepted (Charles, 08/11/2026, 14 h 47, « ok 0082 » ; demande du 08/11/2026 : « Et bien vas y 👌 fais en sorte que ça soit vraiment intuitif, que ça s'intègre bien dans nos process […] pour faciliter la vie des modèles »)
Date : 2026-11-08
Précise : l'ADR 0060 (§ 2, sources 3 et 6 : « dépasse nettement la moyenne de son compte » ; § 4 et § 5 : l'idée et sa fiche de tournage), l'ADR 0057 (§ 6 garde Instagram, § 7 son accord sur les légendes), l'ADR 0042 (§ 4 fiche de tournage). Ne change rien à l'ADR 0060 § 1 : aucun agent ne navigue sur un réseau.

## Contexte

Le 08/11, Charles a fait analyser un paquet public de skills Claude pour Instagram (`Jakeschincariol/instagram-agent-skill`, licence MIT : 13 skills et 5 scripts Python, en anglais, pour un coach ou un indépendant qui vend son expertise). Verdict : rien à installer. Le paquet est en anglais seulement (ses scores cherchent des contractions et des pronoms anglais). Son correcteur de « ton IA » existe déjà chez nous, en français et dans le code : `AI_TICS` des gardes de l'agent, et le retrait des caractères invisibles dans la passerelle. Son entonnoir (sticker lien, mot-clé en commentaire, DM qui livre le lien) est ce que la garde Instagram interdit (ADR 0057 § 6). Et sa recherche de reels viraux fait piloter le navigateur par un agent (ADR 0060 § 1).

Trois idées valent d'être reprises, chacune dans le code :

1. **Classer un post par rapport à la médiane de son compte, pas à sa moyenne.** Un seul post viral gonfle la moyenne et cache le suivant. Exemple : quatre posts à 10 000 vues et un à 1 000 000 donnent une moyenne de 208 000 ; un nouveau post à 400 000 vues ne fait pas trois fois cette moyenne et ne devient pas un signal. La médiane (10 000) le voit à quarante fois.
2. **Ce que le fil montre d'une légende.** Instagram montre le début d'une légende puis cache le reste derrière « … plus ». Environ 125 caractères dans le fil ; plus court sur un Reel, où les sources se contredisent (de 55 à 125 caractères) et où Meta ne publie rien d'officiel (recherche du 08/11). Une légende dont l'essentiel tombe après la coupure ne fait rien.
3. **Des règles de tournage d'un reel qui se vérifient.** La première phrase se dit en moins de trois secondes, le texte à l'écran tient en six mots, le texte reste hors des zones que l'interface d'Instagram recouvre, le plan change souvent, la fin renvoie au début pour que le reel se revoie. Aujourd'hui, la fiche de tournage est un texte libre de 600 caractères (`shoot_brief`) : la créatrice doit lire un paragraphe et rien ne s'y vérifie.

Le même paquet montre aussi ce qu'il ne faut pas faire : son auteur a mesuré que son score d'accroche, calculé sur le seul texte, ne distingue pas les bons reels d'un créateur de ses moins bons (AUC 0,56, à peine mieux que le hasard). Il repère seulement les accroches ratées (0,83).

## Décision

### 1. « Dépasse nettement » se lit sur la médiane du compte

- Un post **ressort** de son compte quand son chiffre fait au moins **trois fois la médiane** des autres posts relus du même compte, dont cinq au moins ont ce chiffre ; les vues, sinon les j'aime. C'est la règle de l'ADR 0060 § 2 pour les sources 3 (comptes de référence) et 6 (capture passive), où « moyenne » devient « médiane ». Le facteur et le minimum de posts restent des constantes du code.
- Un signal né ainsi garde son **écart** (`standout`) : le chiffre comparé (vues ou j'aime), le multiple arrondi vers le bas (par exemple « × 40 ») et le nombre de posts comparés. Quand la médiane est nulle, le post ressort dès un chiffre d'au moins un, et l'écart ne porte pas de multiple. L'écart vit en colonnes de `trend_signals`, pas en JSONB, puisque le code trie dessus (`docs/architecture/jsonb.md`).
- L'agence voit l'écart sur la tendance citée par une idée, dans « Idées du jour » : « 40 × ses vues habituelles », à côté des chiffres déjà montrés. La créatrice ne le voit jamais (ADR 0042 : elle ne voit pas la veille).
- Le job du matin (ADR 0060 § 4) reçoit les signaux vivants rangés par écart décroissant, et chaque multiple comme un fait. Une idée qui citerait un multiple ou un chiffre qu'elle n'a pas reçu est refusée, comme l'ADR 0042 § 5 le fait pour le topo.
- Pour les comptes de référence (VEI-06), l'écran où l'agence les choisit montre la taille de chaque compte à côté de celle de la créatrice, et une phrase d'aide : un compte jusqu'à dix fois plus gros qu'elle apprend le plus ; au-delà, on reprend la forme d'un reel, pas son rythme. C'est une aide, pas une règle : aucun compte n'est refusé pour sa taille.

### 2. La fenêtre visible d'une légende Instagram

- Le code connaît la **fenêtre visible** (`caption_window`) de chaque format Instagram : ce que le fil montre avant « … plus ». C'est le début de la première ligne, jusqu'à un nombre de caractères visibles (un emoji compte pour un) ; par prudence, elle s'arrête aussi au premier saut de ligne. Valeurs de départ : **125** pour une photo ou un carrousel, **60** pour un Reel, la borne basse des chiffres publiés. Ce sont des constantes du code, mesurées sur un téléphone à la recette de PUB-02, puis corrigées dans le code si la mesure les dément. La story n'a pas de légende (ADR 0057 : l'API n'écrit pas son texte).
- **Une légende écrite par le modèle** met dans sa fenêtre visible une phrase complète qui donne envie de lire la suite ou de revoir le reel ; une légende dont la première ligne dépasse la fenêtre n'est pas conforme. Elle suit le chemin de la garde Instagram de l'ADR 0057 § 6 : réécrite une fois, puis ambre ; elle ne part jamais telle quelle.
- **Une légende corrigée par une personne**, l'agence ou la créatrice, n'est jamais refusée pour sa fenêtre : c'est sa voix et son choix (ADR 0057 § 7). L'écran lui montre ce qui sera visible, et une phrase ambre discrète quand la première ligne dépasse : « La fin de ta première phrase sera cachée derrière « … plus ». » Les autres fautes de la garde Instagram restent bloquantes, comme aujourd'hui.
- **L'aperçu** : partout où une légende Instagram se relit avant de partir (le plan de la semaine de l'agence, son accord de la veille), elle est montrée comme le fil la montrera : la vignette du média à son format (4:5 pour le fil, 9:16 pour un Reel), son nom de compte, la fenêtre visible, puis « … plus », qui déplie le reste d'un toucher. C'est un dessin sobre aux couleurs d'Impera, pas une copie de l'interface ni des marques d'Instagram.

### 3. La fiche reel

- Une idée, une suggestion ou une tâche de catégorie de dépôt **Reel Insta** (`instagram_reel`) peut porter une **fiche reel** (`reel_brief`), à côté du texte libre de sa fiche de tournage, qui reste :
  - **la première phrase** (`hook`) : ce qu'elle dit, ou ce qu'on lit, dans les trois premières secondes, **huit mots au plus** ;
  - **le texte à l'écran** (`on_screen`) : **six mots au plus**, facultatif ;
  - **les plans** (`shots`) : de **deux à six**, une ligne chacun (80 caractères au plus), dans l'ordre du tournage ;
  - **la fin** (`ending`) : ce qui renvoie au début pour que le reel se revoie (un mot repris, un geste), facultative, une ligne ;
  - **la durée visée** (`seconds`) : de 5 à 90 secondes.
- Ces bornes sont dans le schéma : elles s'appliquent au modèle, à la correction de l'agence et à la saisie à la main, et le formulaire les montre en compteurs (« 5 / 8 mots ») avant qu'on les dépasse, jamais comme une erreur après coup. Les filtres de l'ADR 0060 § 4 (limites de sa persona, « jamais de nu », garde Instagram) lisent chaque champ de la fiche reel, comme le reste de l'idée.
- **L'agence peut écrire une fiche reel à la main** sur toute suggestion de tournage pour un Reel, sans attendre le job du matin (bloqué tant que la clé xAI manque). C'est le même formulaire que la correction d'une idée.
- Comme la fiche de tournage (ADR 0042 § 4), la fiche reel est copiée une fois dans la tâche qu'elle accepte ; elle la lit et ne la modifie pas.
- **Chez la créatrice, la fiche reel se dessine, elle ne se lit pas comme un paragraphe** : un cadre 9:16 où le texte à l'écran est placé au centre et où les zones que l'interface d'Instagram recouvre (le haut, le bas, le bord droit) sont grisées ; « Ta première phrase » en grand ; les plans numérotés ; « Pour finir » ; la durée. Les mots sont les siens : jamais « accroche », « hook », « boucle », « signal », « score » ni « IA ». Pliée sous « 🎬 Fiche de tournage » sur une proposition, ouverte dans la tâche acceptée, comme aujourd'hui. Les zones grisées sont des constantes de l'interface, approchées et vérifiées sur un téléphone à la recette.
- Une fiche de tournage sans fiche reel s'affiche comme aujourd'hui : rien ne casse pour les autres catégories ni pour une suggestion déjà écrite.

### 4. Ce qui n'est pas repris

- Aucun score d'accroche ni de « ton humain » calculé sur le texte : son propre auteur a montré qu'un tel score ne choisit pas le bon reel, et nos gardes de voix couvrent le reste en français.
- Aucune correction typographique automatique tirée de ce paquet : il remplace l'apostrophe courbe et l'espace insécable, qui sont du français normal tapé sur un téléphone.
- Rien de ce paquet n'est installé dans le dépôt, dans `.claude/` ni dans les sessions.

## Conséquences

Positives :
- La veille ne rate plus le deuxième post viral d'un compte, et l'agence voit d'un coup d'œil pourquoi une tendance compte (« × 40 »).
- La légende se juge comme ses abonnés la verront ; personne ne découvre après la publication que la phrase utile était cachée.
- La créatrice tourne un reel depuis un dessin : sa première phrase, où mettre le texte, quoi filmer et dans quel ordre, combien de temps. Elle n'a plus à interpréter un paragraphe.
- La fiche reel sert dès maintenant, écrite à la main par l'agence, avant que le job du matin tourne.

Négatives, à surveiller :
- Les fenêtres visibles et les zones grisées sont des estimations tant qu'elles ne sont pas mesurées sur un téléphone, et Instagram les change sans prévenir : elles se corrigent dans le code, jamais en réglage.
- La fiche reel ajoute un contrat partagé entre `trends`, `creator-tasks` et l'écran de la créatrice, et une colonne JSONB (`docs/architecture/jsonb.md`) là où vit la fiche de tournage.
- Huit mots, six mots, de deux à six plans : des repères tirés de la pratique du format court, pas d'une mesure sur nos créatrices. Le retour à 48 h (ADR 0060 § 6) dira s'il faut les changer, par une ADR.

## Alternatives rejetées

- **Garder la moyenne en écartant le plus gros post** : moins lisible que la médiane, et deux posts viraux la faussent encore.
- **Refuser une correction humaine qui dépasse la fenêtre** : la légende est sa voix ; l'aperçu suffit à décider.
- **Un modèle de texte dans la fiche de tournage libre** (« Phrase : … / Texte : … ») : ni dessin possible, ni borne vérifiable par le code.
- **Noter les accroches avant le tournage** : mesuré par l'auteur même du paquet, le score ne choisit pas la bonne (AUC 0,56).
- **Installer le paquet de skills** : en anglais, contraire à la règle 3 de `CLAUDE.md` (les règles dans des prompts), et son entonnoir est interdit par l'ADR 0057 § 6.
