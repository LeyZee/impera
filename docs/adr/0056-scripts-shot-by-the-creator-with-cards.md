# 0056. Scripts : l'agence écrit ses structures, la créatrice tourne carton par carton, Nirvana range dans l'ordre et téléverse

Statut : proposed (demande et décisions de Charles du 03/11/2026, 9 h 42, 9 h 47, 9 h 53 et 9 h 58, fil « Repenser le workflow médias et scripts de la modèle » ; « go » le 03/11 à 9 h 58)
Date : 2026-11-03
Remplace : dans l'ADR 0030 § 2, les mots « Nirvana ne téléverse rien vers une plateforme et n'a pas de dossier à lui », et dans l'ADR 0030 § 4, la règle « Fichiers : on garde le minimum », **pour les seuls scripts déposés par la créatrice** ; dans la fiche P6-01, la phrase qui fait de Reveal le seul lieu où l'on crée un script. L'ADR 0030 reste vraie pour tout le reste, et Reveal fait toujours foi pour ce qui a été envoyé à un fan (ADR 0018 § 5, ADR 0030 § 5).
Précise : l'ADR 0055 (catégorie `script`), l'ADR 0030 § 3 (descriptions), la fiche PROPOSED-script-studio (question de la source des scripts, tranchée ici).

## Contexte

Les scripts natifs de Reveal sont le moteur de la vente : l'agent pioche un script jamais envoyé à ce fan et le déroule en mettant de la vie entre les étapes (méthode de chatting § 2.3). Ils ne sont pas encore écrits. Charles veut (03/11) :

- que la créatrice dépose un script **environ toutes les deux semaines** ;
- reprendre le système de **cartons** d'OnlyScript, son ancien outil, « de façon améliorée, moderne, plus jolie, plus intuitive » : des cartons qui disent à chaque étape quel média tourner ; un système qui lui demande le carton puis chaque média de l'étape ; des fichiers renommés « pour que tout soit dans le bon ordre » dans les dossiers, pour l'IA, les chatteurs et le téléversement dans Reveal ;
- reprendre **la création et l'organisation des cartons**, modifiables selon les besoins de l'agence et des scripts : le rendu lui plaisait, le parcours était trop compliqué ;
- des **structures types** qu'il crée, modifie, et qu'il demande à la créatrice dans sa to-do ;
- la cadence réglée **par l'agence**, pas par la créatrice : « c'est vraiment le moteur principal de la vente » ; un script tous les 14 jours par défaut ;
- reprendre d'OnlyScript la description des médias et la génération des textes de vente, repensées avec la méthode.

Lu dans le dépôt `LeyZee/onlyscript` (concepts seulement, jamais le code, `docs/reference/legacy-projects.md`) : une structure y est une liste d'étapes, de ponts et de messages ; chaque étape déclare des emplacements typés (photo, vidéo avec une durée par emplacement, vocal) et jusqu'à trois variantes ; les cartons sont des images 1080 × 1080 rendues par le serveur et insérées devant les médias de leur étape ; un bot Telegram demandait les médias étape par étape ; des règles testées (`STRUCTURE_INVARIANTS.md`) garantissaient l'identité des étapes et figeaient la structure au début d'un dépôt.

## Décision

### 1. La structure (côté agence)

- Une **structure** (`script_structure`) appartient à l'agence ; elle peut être réservée à une créatrice. Elle a un nom, un moment (Jour, Nuit, ou les deux) et une liste ordonnée de **segments** de deux sortes seulement :
  - **étape** (`stage`) : un nom court, ce qu'elle vend en une phrase (l'intention), ses **emplacements** (`media_slot` : photo, vidéo avec durée minimale et maximale, vocal), et jusqu'à trois **variantes** (A, B, C) qui partagent la même étape ;
  - **pont** (`bridge`) : un teaser entre deux étapes, qui pointe vers elles.
  Les textes qu'OnlyScript portait par des segments « message » sont rattachés à leur étape (§ 6).
- Les règles d'OnlyScript sont reprises et testées dans le domaine :
  1. la clé d'une étape ne change jamais ; renommer change son nom, pas sa clé ;
  2. le numéro affiché se recalcule à chaque enregistrement d'après la position ; les variantes d'une étape partagent son numéro ;
  3. un pont désigne ses deux étapes par leur clé, et une référence à une étape absente est refusée ;
  4. une étape sans emplacement est refusée ;
  5. trois variantes au plus, lettres uniques ;
  6. **une structure demandée ou en cours de dépôt est figée** : la modifier crée une nouvelle version ; un dépôt garde la version de son début.
- Les **dégoûts de la persona** filtrent dans le code : une structure dont une étape touche un dégoût de la créatrice ne peut pas lui être demandée, et l'écran dit quelle étape bloque.
- L'atelier des structures : la pile des segments à réordonner au glisser, et à côté **l'aperçu du carton en direct**. Des structures de départ sont fournies, que l'agence duplique et ajuste.

### 2. La demande de script

- La **cadence** est un réglage de l'agence par créatrice (un script tous les 14 jours par défaut), jamais un réglage de la créatrice. À chaque échéance de la cadence, le code crée une demande de contenu (ADR 0055 § 4) de catégorie `script`, avec la structure choisie par l'agence.
- La structure se choisit d'avance : l'agence tient pour chaque créatrice une **file de structures** (les prochaines à demander, dans l'ordre). Sans file, la demande prend la dernière structure utilisée et l'agence est prévenue en ambre. L'agence peut aussi créer une demande à la main, avec la structure de son choix.
- Les rappels sont ceux de l'ADR 0055 § 4.

### 3. Le carton

- Un **carton** (`card`) est rendu par le serveur à partir de la version de la structure : le numéro et le nom de l'étape, ce qu'il faut tourner (« 3 photos, 1 vidéo de 1 à 2 min »), l'ambiance en une phrase, le moment. Pour un pont : les deux étapes qu'il relie et son teaser.
- La palette vient des jetons du design system, pas d'une couleur libre ; la typographie est celle de Nirvana. Le même rendu sort en trois formats : la carte de l'application, le PNG du dossier, une vignette pour l'écran des chatteurs.
- Un carton est un média de la médiathèque marqué comme tel ; le code ne le met jamais dans une offre ni dans un envoi à un fan.
- Le PNG du carton va dans le dossier du coffre Reveal, devant les médias de son étape, tant que l'agence le règle ainsi (réglage par créatrice, activé par défaut) : les chatteurs s'y repèrent.

### 4. Le parcours de la créatrice

- Sa demande de script s'ouvre sur **la pile de cartons** : un par étape et par pont, dans l'ordre. Elle peut la lire avant de tourner.
- Puis **un écran par carton**, avec un cadre vide par emplacement. Elle touche un cadre, choisit dans sa galerie. Le code vérifie au fil de l'eau le type, la durée, l'orientation et le poids (ADR 0055 § 2) ; un cadre en défaut le dit en une ligne.
- Le parcours est enregistré à chaque fichier : elle reprend où elle en était, sur le même appareil ou un autre. Une progression montre les étapes remplies.
- **Envoyer le script** n'est possible que quand chaque emplacement obligatoire est rempli ; un aperçu final montre toutes les étapes.
- Chaque fichier suit l'ADR 0055 § 3 : métadonnées retirées, empreinte calculée par le serveur, doublon refusé.

### 5. La nomenclature

Le serveur nomme et range chaque fichier de façon déterministe, pour que **l'ordre alphabétique soit l'ordre du script**, partout : dans le stockage, dans l'export, dans le coffre Reveal.

- Dossier : `S<nnn>-<moment>-<thème>` ; `<nnn>` est le numéro du script de la créatrice, sur trois chiffres, séquentiel et sans trou ; `<moment>` vaut `jour` ou `nuit` ; `<thème>` est le nom de la structure, en minuscules ASCII et tirets.
- Fichier : `<pp>-<code>-<ii>-<sorte>.<ext>` :
  - `<pp>` est la position du segment dans le script, sur deux chiffres (01, 02…) ;
  - `<code>` vaut `E<n>` pour une étape (avec la lettre de variante : `E1A`), `P<n><m>` pour un pont ;
  - `<ii>` est la position dans le segment, sur deux chiffres ; `00` est réservé au carton ;
  - `<sorte>` vaut `carton`, `photo`, `video` ou `vocal`.
- Exemple : `S014-nuit-salon/03-E2-00-carton.png`, puis `03-E2-01-photo.jpg`, `03-E2-02-photo.jpg`, `03-E2-03-video.mp4`.
- Aucun espace, accent ni emoji dans un nom de fichier. Le nom de dossier dans Reveal garde la convention actuelle de l'agence (« SCRIPT \<thème\> | ☀️ » ou « | 🌙 », inventaire du connecteur, Vault) ; le connecteur fait la correspondance.
- Le nom d'un fichier ne change plus une fois le script envoyé. Remplacer un média avant l'envoi garde sa position.

### 6. Description, identité et textes

- **Description** : chaque média reçoit sa description par le rôle `sense` (ADR 0030 § 3), dans la langue de la créatrice. L'agence valide étape par étape (« Tout valider » pour une étape, correction en ligne sinon). Un script dont un média n'a pas de description validée ne part pas dans Reveal et n'est pas proposable (règle de P6-01, inchangée). La créatrice peut ajouter son ressenti (`creator_note`).
- **Moment** : un média dont la description dit une lumière de nuit dans un script de jour (ou l'inverse) passe en ambre pour l'agence.
- **Identité du script**, calculée à partir des descriptions et de la structure : moment, ambiance, énergie, décor, « à utiliser quand », « à éviter quand ». L'agent et les chatteurs s'en servent pour choisir le script ; le choix final reste au code (moment, cooldown, déjà envoyé, curseur de sexualisation pour ce fan). Les idées de relance ne servent qu'entre deux étapes d'un script en cours, jamais après un refus (une plainte joueuse, puis on lâche) ni après un manque d'argent avoué, et un pack refusé n'est jamais reproposé : ce sont les règles de suivi d'offre que l'agent porte déjà dans son code.
- **Textes**, proposés par le modèle de langage et validés par l'agence, jamais envoyés sans elle. Pour chaque étape : le texte de l'offre (court, dans la voix de la créatrice, ancré sur un détail concret des médias) ; deux ou trois idées de relance entre les cartons, pas un texte figé ; la bulle de renfort juste après l'achat et la question sur ce qu'il en a pensé ; et, inscrits dans la structure, les ressorts de la méthode : faire participer, faire patienter, aftercare après la dernière étape. La structure ne porte que le rythme entre ses étapes ; le nombre d'offres par fan reste au cooldown de l'agent. Prompt versionné, schéma de sortie, évaluations dans `evals/`.
- **Gardes** : les gardes bloquantes de la réponse à un fan s'appliquent telles quelles aux textes d'offre, aux idées de relance et aux bulles de renfort, à la génération **et** à chaque correction par l'agence : au moins `ai_disclosure`, `discount`, `fake_emergency`, `payment_lie`, `love_declaration`, `meeting_promise` et `guilt_trip`, avec les gardes de voix.
- **Prix** : ils viennent de la grille de l'agence par structure (P6-01), jamais du modèle. Cette ADR ne fixe aucun montant ni aucune règle d'argent ; les avertissements de P6-01 (écart entre deux étapes, prix élevé) s'appliquent.

### 7. Vers Reveal, dans l'ordre

- **Nirvana fait foi pour un script tant qu'il n'est pas dans Reveal** : structure, fichiers, noms, descriptions, textes, versions. **Reveal fait foi dès qu'il y est**, pour ce qui a été envoyé à un fan (ADR 0018, ADR 0030 § 5) ; la médiathèque relit ensuite le dossier comme les autres (ADR 0030 § 2), et chaque liaison retrouve son média par l'empreinte et le nom.
- Le port gagne des capacités facultatives, déclarées par des drapeaux (ADR 0018) : créer un dossier du coffre, y téléverser un média, créer un script natif avec ses étapes, ses textes et ses prix. Formes arrêtées d'après la capture, `FakeReveal` d'abord.
- À l'acceptation de l'agence, le connecteur crée le dossier, téléverse **un fichier à la fois, dans l'ordre des noms**, chacun avec sa clé d'idempotence, puis crée le script natif s'il le sait. La garde d'écriture de l'ADR 0018 s'applique. Un échec ne relance jamais à l'aveugle : le script passe en ambre à la position atteinte, et la reprise repart de là.
- **Sans la capacité** (avant la capture, ou si Reveal ne la permet pas) : un **export ZIP** du dossier, dans l'ordre, et une fiche à recopier étape par étape, cochée par l'équipe.
- Les originaux suivent l'ADR 0044 § 2 : effacés 30 jours après leur téléversement dans Reveal (ou après l'export confirmé).

## Conséquences

Positives :
- La créatrice sait exactement quoi tourner, étape par étape, depuis l'application qu'elle ouvre déjà.
- Le dossier arrive rangé : l'IA, les chatteurs et le coffre lisent tous le même ordre.
- Un script ne part pas sans descriptions validées ni textes relus.
- La partie la plus utile (structures, cartons, dépôt guidé, dossier, descriptions) n'attend pas la capture Reveal.

Négatives, à surveiller :
- Nirvana garde des originaux intimes jusqu'au téléversement : même stockage, même effacement daté que l'ADR 0044.
- Deux sources tant qu'un script n'est pas téléversé : la bascule est un état du script, au journal, jamais implicite.
- L'atelier des structures est un écran riche : il doit rester lisible (Liquid Glass, zéro bruit) et sera relu par le propriétaire du web.

## Alternatives rejetées

- **Le bot Telegram d'OnlyScript pour le dépôt** : la PWA fait la même chose avec des cadres visibles et la reprise automatique, sans commandes à taper.
- **Garder les segments « message »** : une notion de plus pour un texte qui appartient à une étape.
- **Trois textes figés par étape, à coller** (OnlyScript) : l'agent déroule et met de la vie entre les étapes ; il lui faut l'offre et des idées, pas un texte figé.
- **Une couleur de carton libre** : c'était l'un des défauts relevés par les audits d'OnlyScript ; la palette du design system suffit.
- **Une cadence réglée par la créatrice** : rejetée par Charles, c'est l'agence qui en a besoin pour vendre.
