# 2026-11-15 — Vitrine des trophées (ADR 0108), code — done
Fait : composant commun de la vitrine (étagères, prochain trophée, fiche, dévoilement, lecture seule) ; Moi › Trophées du chatteur et de la créatrice ; corrections de l'avis Design (pastille de gain muette sur la page, « Rang » au lieu de « Niveau N », unité des shifts, noms sur deux lignes au téléphone, « Voir tout » au téléphone seulement) ; écrans réels validés par Charles (lot vitrine-trophees-ecrans-2).
Pas fait : insigne de rang (attend #763) ; vue de l'agence (§ 19).
Décisions : aucune nouvelle (ADR 0108).
Découvertes : un ternaire de composants dans un `component` de route de `router.tsx` rend `useRouteContext()` `any` pour le lint typé ; le choix de page se fait dans la page.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
