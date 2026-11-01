# 2026-10-25 — modules.md à l'état de main — done
Fait : le tableau « Modules et phases » de `docs/architecture/modules.md` disait « squelette » pour sept modules qui tournent depuis #74 à #149. Il dit maintenant ce que chacun fait, et `telegram` y entre (ligne du tableau et feuille du graphe, comme `eslint.config.js`). `docs/playbooks/add-an-llm-provider.md` pointe les tarifs vers `packages/llm/src/catalog.ts` (champ `pricing`) : `pricing.ts` n'existe pas.
Pas fait : les autres avertissements de `check-repo` citent des chemins à venir (FakeReveal, la plateforme propre, la note vocale) ou sont dans des journaux, des fiches et une ADR qu'on ne réécrit pas. `docs/design/brief.md` (`tokens.css`) appartient au fil Refonte.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓ ; chaque ligne du tableau relue contre les routes et les jobs du module dans main.
