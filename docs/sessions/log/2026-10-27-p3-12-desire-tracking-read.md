# 2026-10-27 — P3-12 note de désir : lecture du Suivi

- **Fil** : Bilan (plomberie). Lecture demandée par la fiche `P3-12-desire-screens.md` (Extension), après la fusion de #222.
- **Fait** :
  - `ConversationSummarySchema.desire` (`ConversationDesireSchema`, `{ score, band } | null`) : la note stockée retombée jusqu'à l'heure de la réponse (`desireNow`, plancher 0 jusqu'à P6-01) et la bande de cette note retombée (`desireBandOf`), jamais `desire_band` ; `null` avant le premier `desire_scored`. Le détail d'une conversation la porte aussi.
  - `GET /v1/conversations/{id}/desire?creatorId=…` → `DesireCurveSchema` : un point par `desire_scored` (`at`, `before`, `score`, `signals`), les `DESIRE_POINTS_MAX` (200) plus récents, du plus ancien au plus récent. Mêmes droits que `/events` : propriétaire, manager, chatteur seulement sur une conversation routée vers lui, jamais la créatrice.
  - Le lecteur des conversations prend l'horloge du module.
  - `docs/conventions/api.md` : la courbe est la seule lecture bornée sans curseur.
- **Tests** : `desire.test.ts` (point sans `before`, 200 points au plus), `conversations-http.integration.test.ts` (note retombée de 80 à 40 et bande « joueur », `null` sans note, courbe de 205 changements coupée aux 200 derniers, droits du chatteur et de la créatrice). Les fixtures du Suivi (`apps/web`) prennent `desire: null`.
- **Découvertes** : aucune.
