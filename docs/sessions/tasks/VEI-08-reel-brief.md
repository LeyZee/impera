# VEI-08 Fiche reel : la créatrice tourne un reel depuis un dessin, pas depuis un paragraphe
Statut : done
Phase : veille (ADR 0060 § 4 et § 5, ADR 0082 § 3) et agenda de la créatrice (ADR 0042 § 4)
Dépend de : ADR 0082 (acceptée le 08/11/2026) ; VEI-01 (fait : idée → suggestion → tâche) ; l'agenda tel qu'il existe (`apps/web/src/screens/agenda`, `apps/web/src/creators/agenda`)
Branche : task/vei-08-reel-brief
Propriétaire proposé : Bilan (lot a : contrats, base, modules `trends` et `creator-tasks`) ; Extension (lot b : formulaire de l'agence et écran de la créatrice)

## Objectif (1 phrase)

Quand l'agence propose un Reel, la créatrice reçoit une fiche qu'elle comprend d'un coup d'œil (sa première phrase en grand, où mettre le texte sur l'image, quoi filmer dans quel ordre, comment finir, combien de temps), et l'agence l'écrit en une minute, avec des compteurs plutôt que des erreurs.

## Pourquoi c'est utile tout de suite

La fiche de tournage est aujourd'hui un texte libre de 600 caractères (`ShootBriefSchema`) : la créatrice lit un paragraphe sur son téléphone et rien ne s'y vérifie. La fiche reel se remplit **à la main** par l'agence sur une suggestion : elle sert dès cette fiche fusionnée, sans attendre le job du matin, que la clé xAI bloque encore (VEI-03).

## Contexte à lire

- ADR 0082 § 3, ADR 0042 § 4 (fiche de tournage, elle lit et ne modifie pas), ADR 0060 § 4 (filtres) et § 5 (validation), ADR 0057 § 6 (garde Instagram), ADR 0055 § 1 (catégorie `instagram_reel`).
- `packages/contracts/src/creator-tasks.ts` (`ShootBriefSchema`, suggestion, tâche), `packages/contracts/src/trends.ts` (`ContentIdeaDraftSchema`, `ContentIdeaCorrectionSchema`), `packages/contracts/src/public-outputs.ts`.
- `apps/api/src/modules/trends/README.md` (« Idées du jour », `guardFaultOf`, `suggestShoot`), `apps/api/src/modules/creator-tasks/` (stores de suggestion et d'agenda, copie de la fiche à l'acceptation).
- `apps/web/src/screens/agenda/ShootBrief.tsx` et `SuggestionCard.tsx` (chez elle), `apps/web/src/creators/agenda/AgendaSection.tsx` (suggestion écrite par l'agence), `apps/web/src/creators/ideas/IdeasSection.tsx` (correction d'une idée).
- `docs/architecture/jsonb.md`, `docs/design/README.md`, `packages/design-system/README.md`.

## À faire (liste vérifiable)

### Lot a : Bilan

- [x] **Contrat** `ReelBriefSchema` (`creator-tasks.ts`, lu par `trends`) : `hook` (8 mots au plus), `onScreen` (6 mots au plus, nullable), `shots` (2 à 6 lignes de 80 caractères au plus), `ending` (80 caractères au plus, nullable), `seconds` (entier de 5 à 90). Les bornes sont des constantes exportées (`REEL_HOOK_WORDS_MAX`, `REEL_ON_SCREEN_WORDS_MAX`, …).
- [x] **Compter les mots** : une fonction pure des contrats, la même pour le schéma et pour les compteurs de l'écran, afin que le formulaire et le serveur ne divergent jamais. Un mot est une suite de lettres ou de chiffres ; une apostrophe ou un trait d'union à l'intérieur ne coupe pas (« j'ai » et « peut-être » comptent pour un) ; un emoji ne compte pas. Tests.
- [x] `reelBrief` facultatif sur l'idée (`ContentIdeaDraftSchema`, sa correction, sa lecture), sur la suggestion de l'agence (corps et lecture) et sur la tâche ; refusé (400) sur une autre catégorie de dépôt que `instagram_reel`.
- [x] **Base** : `reel_brief jsonb` nullable, `CHECK (jsonb_typeof(reel_brief) = 'object')`, sur `content_ideas`, `creator_suggestions` et `creator_tasks` ; parsé par Zod à l'écriture et à la lecture (`jsonb.md`). Nouvelle migration, numéro donné par la coordination.
- [x] **Copie** : la fiche reel suit le même chemin que `shoot_brief` (idée validée → suggestion par `suggestShoot` ; suggestion acceptée → tâche, copiée une fois). Elle ne la modifie jamais.
- [x] **Gardes** : `guardFaultOf` lit `hook`, `onScreen`, `shots` et `ending` comme le reste de l'idée (limites de sa persona, « jamais de nu », garde Instagram) ; une suggestion écrite à la main passe les mêmes gardes avant d'entrer dans son agenda. Une faute donne la 422 existante, avec le champ fautif.
- [x] README de `trends` et de `creator-tasks`.

### Lot b : Extension

- [x] **Chez la créatrice** : un composant `ReelBrief`, rendu par `ShootBrief` quand la fiche reel existe (plié sur une proposition, ouvert dans la tâche acceptée, comme aujourd'hui) :
  - en haut, « Ta première phrase » et la phrase en grand, entre guillemets ;
  - un cadre 9:16 dessiné en SVG, à hauteur de pouce, avec le texte à l'écran au centre et les zones que l'interface d'Instagram recouvre (le haut, le bas, le bord droit) grisées, et une ligne dessous : « Garde ton texte dans la zone claire » ;
  - « Ce que tu filmes » : les plans numérotés, une ligne chacun ;
  - « Pour finir » s'il y en a une ; la durée, « ≈ 20 s », en `nv-num` ;
  - le texte libre de la fiche de tournage, s'il y en a un, en dessous ;
  - jamais « accroche », « hook », « boucle », « IA » ni « signal » ; Nuit et Jour ; d'abord le téléphone (360 px de large) ; `prefers-reduced-motion` respecté ; le dessin a un texte de remplacement qui dit la même chose.
- [x] **Chez l'agence** : quand la catégorie est « Reel Insta », le formulaire de suggestion (`creators/agenda`) et la correction d'une idée (`creators/ideas`) montrent une section « Fiche reel » :
  - « Première phrase » avec un compteur « 5 / 8 mots », « Texte à l'écran » avec « 3 / 6 mots » : le compteur passe en ambre à la limite et le champ ne prend pas de mot de plus ; aucune erreur rouge après coup ;
  - « Plans » : de deux à six lignes, ajouter, retirer, monter, descendre ;
  - « Pour finir », facultatif ; « Durée », un curseur de 5 à 90 secondes, par pas de 5 ;
  - à côté (en dessous sur téléphone), l'**aperçu exact** de ce qu'elle verra : le même composant `ReelBrief`, mis à jour à chaque frappe.
- [x] Les zones grisées sont des constantes en un seul endroit, commentées « approchées, mesurées à la recette ».
- [x] Tests des composants : rendu complet, rendu sans les champs facultatifs, fiche de tournage sans fiche reel (rien ne change), compteurs et limite, l'aperçu de l'agence égal à la vue de la créatrice.

### Recette

- [ ] Sur un iPhone et un Android, un vrai Reel ouvert dans Instagram à côté de la fiche : les zones grisées couvrent bien ce que l'interface cache ; constantes corrigées sinon, valeurs et date dans le commentaire.
- [x] Captures de la PR avec des données inventées (prénom fictif, phrases évidemment fausses), en Nuit et en Jour, sur téléphone.

## Critères d'acceptation

- Une suggestion « Reel Insta » écrite à la main avec une fiche reel arrive dans son agenda, se lit pliée sur la proposition et ouverte dans la tâche, identique à l'aperçu de l'agence.
- Un mot de trop est impossible à saisir et refusé par le serveur s'il arrive quand même (400) ; un mot interdit par sa persona ou par la garde Instagram donne la 422 et la suggestion n'entre pas.
- Une fiche de tournage sans fiche reel, ancienne ou d'une autre catégorie, s'affiche exactement comme avant.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre

- Le job du matin qui écrit la fiche reel (VEI-03) : son prompt et son schéma de sortie la demanderont pour une idée Reel ; sa fiche lit l'ADR 0082 § 3.
- Un prompteur ou un mode tournage pour les reels (SC-07 couvre les scripts ; à proposer à part si Charles le veut).
- Toute note ou tout score d'accroche (ADR 0082 § 4).

## Notes de session

Session du 08/11/2026 (branche de la session `claude/project-thread-0r0fge`, à la place de `task/vei-08-reel-brief`), une seule PR pour les deux lots.

## Résultat

- **Contrat** : `ReelBriefSchema`, bornes exportées, `countWords` et `keepWords` partagés par le schéma et les compteurs de l'écran. `reelBrief` sur l'idée (brouillon, correction, lecture), la suggestion et la tâche ; 400 hors `instagram_reel`.
- **Base** : migration `0140_reel_brief` (`reel_brief jsonb` + `CHECK jsonb_typeof = 'object'` sur les trois tables ; sur `content_ideas`, seulement en catégorie `instagram_reel`).
- **Gardes** : `guardFaultOf` lit la fiche reel champ par champ ; la 422 dit le champ fautif (`details.field`). Une suggestion écrite à la main pour une sortie (« Pour : Reel Insta », `dropCategory`, envoyé et non stocké) passe les mêmes gardes par un `ShootGuard` branché à la racine de composition : `creator-tasks` n'importe pas `trends`.
- **Écran** : `ReelBrief` chez elle (plié sur la proposition, ouvert dans la tâche), « Fiche reel » chez l'agence (suggestion et correction d'idée) avec compteurs ambre, plans déplaçables, curseur de durée dessiné, aperçu exact à côté. Zones grisées dans `apps/web/src/screens/agenda/reel-zones.ts`.

### Ce qui reste

- Recette téléphone : mesurer les zones grisées sur un iPhone et un Android à côté d'un vrai Reel, et corriger `reel-zones.ts` (valeurs et date).
- Sans persona active, une suggestion pour une sortie est refusée (422), comme une idée : la persona de Messa est encore inactive.
