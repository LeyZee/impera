# P3-12 (écrans) Note de désir dans le Suivi, le lecteur et la Persona
Statut : done (partie Extension de `P3-12-desire-score.md`, même ID)
Phase : 3 (politique de l'agent)
Dépend de : `P3-12-desire-score.md` (moteur, #222), liste fermée `DESIRE_SIGNALS` et bandes dans `packages/contracts/src/desire.ts` (accord de Bilan du 27/10), DTO du Suivi (Bilan)
Branche : claude/extension-reveal-playground-45axcj

## Objectif
Le propriétaire, le manager et le chatteur en poste voient où en est chaque fan (neutre, joueur, chaud) sans que la liste devienne une carte de chaleur, comprennent dans le lecteur ce qui a fait bouger la note, et le propriétaire règle les deux seuils de la persona en voyant dans quelle bande ils tombent.

## Contexte à lire
`P3-12-desire-score.md` (§ Écrans), `packages/contracts/src/desire.ts` (`DESIRE_BANDS`, `DESIRE_BAND_FLOORS`, `desireBandOf`), `packages/contracts/src/conversations.ts` (`ConversationSummarySchema`), `packages/contracts/src/persona.ts` (`PERSONA_BOUNDS`), `apps/web/src/screens/tracking/` (`TrackingPage.tsx`, `Reader.tsx`, `view.ts`), `apps/web/src/creators/persona/tabs.tsx` (Stratégies), `apps/web/src/agent/causes.ts` (modèle des libellés), `docs/design/README.md` (Graphiques, `nv-gauge`, néon), ADR 0024 et 0025.

## Ce que l'écran attend du serveur (Bilan)
L'écran ne calcule rien de la note : ni retombée, ni plancher des achats, ni bande.
- **Liste du Suivi** : `ConversationSummarySchema` gagne `desire: { score, band } | null`. La note est déjà retombée à l'instant de la réponse (`desireNow`, qui passe dans `packages/contracts/src/desire.ts` puisque le lecteur des conversations n'importe pas le module `agent` ; plancher de sept jours d'achat, qui vaut 0 jusqu'à P6-01) et la bande vient de `desireBandOf`. `null` veut dire qu'aucun `desire_scored` n'existe encore : l'écran n'affiche alors rien, jamais « neutre » ni 0.
- **Lecteur** : une lecture des points de la courbe, tirés des événements `desire_scored` de la conversation, du plus ancien au plus récent : `{ at, before, score, signals }`, où `before` est `null` sur le premier point (aucune note avant lui), avec `signals` typés par `DesireSignalSchema` (liste fermée). Un point par événement, au plus 200, les plus récents s'il y en a davantage. La retombée entre deux messages se lit dans l'écart entre le `score` d'un point et le `before` du suivant ; l'écran ne la recalcule pas.
- Les droits suivent ceux de la conversation : propriétaire et manager ; chatteur seulement sur la créatrice de son shift en cours (ADR 0025) ; jamais la créatrice.

## À faire
- [x] **Libellés** (`apps/web/src/agent/desire.ts`) : `DESIRE_BAND_LABELS: Record<DesireBand, string>` (« neutre », « joueur », « chaud ») et `DESIRE_SIGNAL_LABELS: Record<DesireSignal, string>`, exhaustifs, dans les mots du glossaire, à côté de `causes.ts`. Un signal répété se regroupe à l'affichage (« emoji suggestif ×2 »). `minor_suspected`, `age_disputed` et `frozen` ont leur phrase (« remise à zéro : âge douteux », « figée : vente arrêtée sur ce message »).
- [x] **Liste du Suivi** : la sous-ligne garde sa forme et gagne la bande en mot à la fin (« A écrit il y a 5 min · joueur »), en `ink-muted`. La liste ne prend ni couleur par ligne, ni rouge, ni néon, ni chiffre : la note se lit dans le lecteur. Elle tient à 400 px et avec le lecteur ouvert.
- [x] **Tri** : un `nv-seg` « Récents · Chauds d'abord » au-dessus de la liste, avec « Récents » par défaut. « Chauds d'abord » range par note décroissante, puis par récence, et les conversations sans note viennent à la fin. « À traiter » reste en tête dans les deux ordres. Le choix est retenu sur l'appareil, comme l'apparence.
- [x] **Fiche du fan dans le lecteur** : une ligne « Désir » avec la bande en mot et une `nv-gauge` sans modificateur. Elle reste donc neutre à toute valeur : jamais `--amber` ni `--neon`, puisque cette jauge ne compte pas un budget. Un libellé accessible dit « Note de désir : 62 sur 100, joueur ».
- [x] **Courbe dans le lecteur** : `nv-chart` en `data-1` (on fixe `--_c`, car le néon est la couleur par défaut du composant), grille `hairline`, axe de 0 à 100. Les deux seuils de bande (40 et 70) sont tracés en traits `hairline` pointillés et nommés en `caption`. L'info-bulle s'ouvre au survol, au toucher et au focus clavier. Elle dit l'heure (`clockOf(minuteOf(at, zone))` de `apps/web/src/scheduling/time.ts`, espaces insécables), le mouvement (`score - before`, « +14 » ou « −8 », chiffres tabulaires ; sur le premier point, dont `before` est `null`, « Première note : 46 ») et les signaux en mots. En mouvement réduit, la courbe paraît sans se dessiner. Avec moins de deux points, la courbe laisse place à une ligne d'encre pâle (« Pas encore assez de messages pour une courbe »).
- [x] **Persona › Stratégies** : `sexualization.min_desire_to_open` dans le pli « Sexualisation » et `script_launch.min_desire` dans « Lancement des scripts ». Ce sont les mêmes champs bornés que les autres (`PERSONA_BOUNDS.sexualizationMinDesireToOpen`, `scriptMinDesire`). Un champ vide prend la valeur par défaut et le dit (« Par défaut : 40 »). Sous chaque champ, une ligne dit la bande où tombe la valeur, par `desireBandOf` : « À partir de 60 : bande joueur ». Le seuil d'un script pris sous 70 ajoute « le Suivi dira encore joueur quand les scripts partent », en encre pâle et jamais en ambre, car ce réglage est permis. Les droits restent ceux de l'écran Persona (le propriétaire et la créatrice enregistrent, les autres lisent).

## Critères d'acceptation
- Tests (Vitest, Testing Library) :
  - chaque `DesireSignal` et chaque `DesireBand` a son libellé (test sur la liste des contrats) ;
  - une conversation avec `desire: null` n'affiche aucune bande ;
  - « Chauds d'abord » range bien et garde « À traiter » en tête ;
  - la jauge ne prend jamais `nv-gauge--amber` ni `nv-gauge--neon`, à 0, 69, 70 et 100 ;
  - l'info-bulle d'un point dit le mouvement et les signaux en mots, et celle du premier point dit « Première note » ;
  - le libellé du seuil change de bande à 40 et à 70.
- Écrans : Nuit et Jour, 1 440 et 400 px, mouvement réduit, état « Le serveur ne répond pas » (la liste se lit sans la note si sa lecture échoue).
- `pnpm check` et `pnpm test` verts.

## Hors périmètre
Le calcul de la note et ses poids (`P3-12-desire-score.md`), le DTO et sa route (Bilan), le routage par valeur (`PROPOSED-hybrid-routing-by-value.md`), la phase de vente et les autres colonnes du Suivi (`PROPOSED-tracking-sales.md`), la vue « Tableau ».

## Notes de session
- 2026-10-27 (fil Extension) : fiche écrite après la relecture de #222. Elle attend la lecture du Suivi par Bilan.
- 2026-10-27 (fil Extension) : précisions de Bilan reportées (`desireNow` dans les contrats, plancher à 0 jusqu'à P6-01, `before` à `null` sur le premier point).
- 2026-10-27 (fil Bilan) : lecture posée. `ConversationSummarySchema.desire` (`ConversationDesireSchema`, aussi dans le détail) et `GET /v1/conversations/{id}/desire?creatorId=…` → `DesireCurveSchema` (`{ points }`, `DesirePointSchema`, au plus `DESIRE_POINTS_MAX`), mêmes droits que `/events`.
- 2026-10-27 (fil Extension) : écrans faits. Libellés dans `apps/web/src/agent/desire.ts` (`thresholdHint` pour la Persona), bande en fin de sous-ligne, ordre « Récents · Chauds d'abord » retenu sous `nirvana.suivi.order`, fiche « Désir » et courbe dans `screens/tracking/Desire.tsx`. La courbe n'est lue qu'à l'ouverture de la fiche. « Chauds d'abord » ne range que les conversations chargées, et l'écran le dit quand il en reste d'autres. Une info-bulle d'un point haut s'ouvre sous lui, pour ne pas couvrir la ligne « Désir ». Vu à l'œil en Nuit et Jour, à 1 440 et 400 px, sur un faux serveur jetable.
- 2026-10-27 (fil Extension, relectures de #229) : les seuils tracés lisent `DESIRE_BAND_FLOORS`. Après un silence, la courbe finit par un point « Maintenant » en pointillés au score de la jauge, avec « Retombée depuis son dernier message ».
- 2026-10-27 (fil Extension, recette locale) : avec plusieurs créatrices, le nom de la créatrice en tête de ligne faisait couper la bande par les points de suspension, à 1 440 px comme à 400 px. La bande est maintenant à part, et c'est le reste de la ligne qui se coupe.
