# 2026-10-23 — D-01 Refonte : lueur, ressort unique, thème Jour — done
Fait : le titre du Dashboard ne luit plus qu'en ambre ou en rouge (relecture Dashboard de #120) ; un état calme garde une lueur de fond atténuée et des mots sans halo ; en Jour, la lueur s'efface et le texte n'a plus de halo (il faisait une tache brune derrière l'encre). Durées et décalages ramenés aux jetons dans le design system, la coquille, le Dashboard et le Playground : nouveaux jetons `--nv-stagger` (50 ms entre deux entrées) et `--nv-dur-data` (1 000 ms, une donnée qui se dessine, au rythme de `countUp`) ; les gestes des icônes de navigation passent tous en `dur-morph`, les repliements sur `ease-spring-smooth`. `nv-tag--declared` (« Règle stricte », mots déclarés) devient une pastille neutre au lieu du néon. Le bandeau Telegram du Dashboard passe du verre à une plaque.
Pas fait : un moyen de choisir le thème Jour dans le CRM (aucun écran ne pose `data-theme="light"` aujourd'hui ; question posée à Charles).
Décisions : aucune.
Découvertes : l'interrupteur allumé reste néon, c'est l'usage prévu (« état allumé »). Les boucles qui respirent (pings, orbes, pulsations) gardent leurs durées propres.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, Dashboard (calme et urgent), Créatrices, Playground et Suivi capturés en Nuit et en Jour dans Chromium.
