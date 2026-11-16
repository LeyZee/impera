# 2026-11-16 — Recette du 16/11, R1 : l'heure de l'agence et de la créatrice, pas celle de l'appareil (CHT-01, CRE-08) — in_progress

Fait : cinq écrans lisaient l'heure de l'appareil alors que le reste de l'application parle à l'heure de l'agence ou de la personne. Suivi du chatteur hors shift (« Prochain shift ») : fuseau de sa fiche (`useMyZone`). Aujourd'hui et Agenda de la créatrice : son propre fuseau, celui que l'agenda renvoie (`useHerClock`), pour « aujourd'hui », la semaine lue et les heures de ses fans. Liste des créatrices (« En poste … jusqu'à ») et Historique des alertes (date d'une ligne ancienne) : fuseau de l'agence (`/v1/scheduling/settings`). Tant que le fuseau n'est pas lu, l'appareil sert de repli. Tests : un par écran, avec un fuseau éloigné de celui de l'appareil.
Pas fait : `readerZone()` reste dans ContentPage, CreatorSalesPage et CreatorReader, que le lot C réécrit ; à reprendre après lui. CHT-07 et CHT-15 sont au fil Chiffres.
Décisions : aucune.
Découvertes : le Dashboard (`viewerZone` de `live.ts`), « Mon heure » du Planning et les valeurs par défaut de DayField, ReportPanel et MyReports lisent l'appareil à dessein ou reçoivent le fuseau de leur appelant ; laissés tels quels.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (voir la PR).
