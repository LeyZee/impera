# 2026-11-20 — Pas de conclusion sur trop peu de ventes — review
Fait : ADR 0092 § 5 sur le Dashboard de l'agence. `canConclude` (ventes de la période et jours couverts par le registre, bornés à aujourd'hui) décide si « Quand ça vend » écrit son créneau et son pic, et si « Les fans » écrit sa concentration ; sinon « Pas encore assez de ventes pour conclure. ». Les chiffres restent tous.
Ajout (même jour, demande de Charles) : la carte « Quand ça vend » prend une teinte violet-fuchsia du pâle au vif (jeton `--nv-heat`, accord de Design), le meilleur créneau est entouré d'un anneau lumineux, la barre du top 10 prend la même teinte ; tant qu'on ne conclut pas, la carte et la barre restent grises et pâles. Deux phrases : « Pas encore assez de recul pour conclure. » (registre trop récent) et « Pas encore assez de ventes pour conclure. ».
Pas fait : avis Design et validation des nouvelles captures.
Décisions : aucune ADR touchée.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests du dossier agency du Dashboard, pnpm check.
