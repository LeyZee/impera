# 2026-10-27 — Fiche des écrans de la note de désir (P3-12, partie Extension) — done

Fait : relecture de #222 côté web (bandes et seuils dans les contrats seuls, liste fermée des signaux, répétition d'un signal, lecture du Suivi à poser) ; fiche `docs/sessions/tasks/P3-12-desire-screens.md` : ce que l'écran attend du serveur (note déjà retombée ou `null`, bande, points de la courbe depuis `desire_scored`), bande en mot dans la sous-ligne, tri « Chauds d'abord » en option, jauge neutre dans la fiche du fan, courbe `nv-chart` en `data-1` avec les seuils de bande, seuils de la persona avec la bande où ils tombent.
Pas fait : le code des écrans, qui attend le DTO du Suivi (Bilan).
Décisions : la liste ne montre que la bande en mot, jamais le chiffre ; un fan sans note n'a pas de bande affichée ; la jauge n'utilise jamais `--amber` ni `--neon`.
Découvertes : `nv-chart` prend le néon par défaut (`--_c`) : chaque graphique qui n'est pas « le chiffre dont parle l'écran » doit le fixer, à rappeler dans `docs/design/README.md` si un autre écran tombe dans le piège.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓.
