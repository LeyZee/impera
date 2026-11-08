# Légende Instagram : ce que le fil montre avant « … plus », vérifié pour le modèle et montré à tous
Statut : proposed (attend l'acceptation de l'ADR 0082 ; ID proposé : PUB-03)
Phase : publication (ADR 0057, ADR 0082 § 2)
Dépend de : ADR 0082 acceptée ; PUB-02 (bloquée : compte pro, appli Meta) pour les écrans où une légende Instagram se relit
Branche : task/pub-03-caption-window
Propriétaire proposé : Bilan (lot a : contrats et garde) ; Extension (lot b : aperçu)

## Objectif (1 phrase)

Une légende Instagram se relit comme ses abonnés la verront (le début visible, puis « … plus »), celle du modèle met l'essentiel avant la coupure, et celle d'une personne n'est jamais refusée pour sa longueur.

## Contexte à lire

- ADR 0082 § 2, ADR 0057 § 6 (garde Instagram : réécrite une fois, puis ambre) et § 7 (son accord la veille, sa correction).
- `packages/contracts/src/public-outputs.ts` (`instagramFaults`, `INSTAGRAM_KEYWORDS_MAX`).
- La fiche PUB-02 : c'est elle qui crée la génération des légendes, le plan Instagram de l'agence et l'écran d'accord de la créatrice.
- `docs/design/README.md` ; `apps/web/src/screens/agenda/` pour le ton des écrans de la créatrice.

## À faire (liste vérifiable)

### Lot a : Bilan

- [ ] **Contrat** : `CAPTION_WINDOW` par format (`feed` : 125, `reel` : 60, valeurs de départ de l'ADR 0082) et `captionWindowOf(text, format)` → `{ visible, hidden, overflows }`. On compte les caractères visibles avec `Intl.Segmenter` (un emoji ou une lettre accentuée compte pour un), on s'arrête au premier saut de ligne, et on ne coupe jamais au milieu d'un mot dans l'aperçu.
- [ ] **Garde du modèle** : une faute `first_line_too_long` pour une légende **écrite par le modèle** dont la première ligne dépasse la fenêtre de son format. Elle prend le chemin de la garde Instagram (réécrite une fois, puis ambre) dans la génération de PUB-02. Elle n'est **jamais** appliquée à une correction humaine : `instagramFaults` ne la porte pas, une fonction à part la porte, et un test le prouve.
- [ ] Tests : 125 et 60 caractères pile, un caractère de plus, emoji, lettres accentuées, saut de ligne avant la limite, légende vide, légende d'une seule ligne courte.

### Lot b : Extension

- [ ] Composant `CaptionPreview` : la vignette du média à son format (4:5 pour le fil, 9:16 pour un Reel), le nom du compte, la partie visible, puis « … plus » qui déplie le reste d'un toucher et se replie de même. C'est un dessin sobre aux couleurs d'Impera (plaque `nv-plate`, Geist) : ni logo, ni icône, ni interface copiés d'Instagram.
- [ ] Dans le champ de correction (agence et créatrice), l'aperçu se met à jour à chaque frappe. Quand la première ligne dépasse, une phrase ambre discrète : « La fin de ta première phrase sera cachée derrière « … plus ». » (« sa » pour l'agence). Rien n'est bloqué pour la fenêtre ; les autres fautes de la garde Instagram restent bloquantes, comme aujourd'hui.
- [ ] Branché là où PUB-02 fait relire une légende Instagram : le plan de la semaine de l'agence et l'accord de la veille de la créatrice.
- [ ] Tests du composant : plié, déplié, phrase ambre présente ou absente, format fil et format Reel.

### Recette

- [ ] Sur un iPhone et un Android, en français : une légende de test publiée en photo, puis en Reel, sur le compte de test de PUB-02 ; on note où « … plus » tombe vraiment, on corrige `CAPTION_WINDOW` si besoin, avec la date de la mesure en commentaire.

## Critères d'acceptation

- Une légende du modèle dont la première ligne dépasse n'est jamais publiée telle quelle : réécrite une fois, puis ambre.
- La même légende corrigée par la créatrice part si les autres gardes passent, et elle a vu avant d'accepter ce qui serait caché.
- L'aperçu de l'agence et celui de la créatrice sont le même composant.
- `pnpm check` et `pnpm test:all` verts.

## Ordre

Le lot a peut s'écrire avant PUB-02, mais il n'entre dans `main` qu'avec son premier lecteur (`knip` refuse un export que rien ne lit) : en pratique, dans la même PR que le lot des légendes de PUB-02, ou juste après.

## Hors périmètre

- Les stories (pas de légende par l'API, ADR 0057) et le canal Telegram (ADR 0080, sans coupure de ce genre).
- Le choix des mots-clés et du texte : la garde Instagram et le prompt de PUB-02.

## Notes de session
