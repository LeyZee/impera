# 2026-11-02 — ARC-01 : les sommes et la prévision de quinzaine rendues par le serveur — partie serveur
Fait : `GET /v1/payroll/periods/:period` rend `summary` (mêmes chiffres que la ligne de liste) et `pace` (net tardif, prévision de fin de quinzaine, part d'objectif atteinte et prévue) ; une seule prévision d'objectif pour tous (ADR 0047, « ok A »).
Décisions : le membre obtient le net d'équipe par une lecture système qui ne rend que deux sommes ; horloge injectée dans le module ; prévision nulle avant un jour écoulé.
Pas fait : le retrait des calculs côté web (fil Extension, après fusion).
Découvertes : le test ffmpeg « kills a call that runs past its time » (#382) dépasse 5 s quand `pnpm test` tourne en entier sur 4 cœurs et bloque le pre-push ; signalé au fil Sécurité.
