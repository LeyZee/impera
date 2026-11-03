# 2026-11-03 — CR-12 Calendrier des shifts, lot a (serveur) — in_progress
Fait : migration 0069 (`calendar_reader_scope`, `calendar_shifts`, `calendar_agent`, `SECURITY DEFINER`, frontière recalculée depuis `app.user_id`) ; contrat `calendar.ts` ; règles pures `domain/calendar.ts` (heures de l'agent, créneaux à l'heure murale, à pourvoir et IA seule, charge, couverture des comptes) ; lecture `infra/calendar-reads.ts` dans une seule photo ; route `GET /v1/scheduling/calendar` (vues `agency`, `team`, `own`) ; README du module et glossaire (Calendrier, IA seule, Couverture des comptes).
Pas fait : écrans (lot b), liens iCal (lot c), places et réglages datés d'ADR 0049, couche de la créatrice et éléments « utile à l'équipe » (CR-05) ; export de `slotsToFill` par `index.ts`, laissé à EQ-14 qui le lira.
Décisions : la vue (`agency`, `team`, `own`) se lit dans la même transaction que les deux fonctions ; pour l'agence, les comptes et les shifts par compte viennent de la lecture du planning (mêmes politiques que Planning), pas d'une troisième fonction.
Relectures : Bilan d'accord, un test fige le mode de l'agent sur celui du tableau de bord ; Équipe : un créneau entamé par un shift reste à pourvoir s'il garde un trou (`open`), comme dans Planning, et « IA seule » exige qu'aucun shift ne le touche.
Découvertes : `tx.execute` rend les `timestamptz` en chaînes (les types de Drizzle) : `z.coerce.date()` comme `llm-call-store.ts`.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, intégration : `calendar-rls` 17 ✓, `scheduling-calendar` 6 ✓, hygiène ✓.
