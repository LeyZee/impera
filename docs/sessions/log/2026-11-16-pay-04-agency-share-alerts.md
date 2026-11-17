# 2026-11-16 — PAY-04 : les alertes de part de l'agence arrivent dans le CRM — review
Fait : `scheduling.check_agency_shares` prévient chaque compte propriétaire de chaque alerte de part de la quinzaine (`agency_share_mismatch`, `agency_share_changed`) par une notification push, motif `agency_share` (migration 0220), une fois par compte et par événement ; le message ne porte ni montant ni part, et ouvre la feuille « Part de l'agence ». La feuille liste ces alertes en ambre au-dessus des parts lues (`alerts` de `GET /v1/creators/:creatorId/agency-rates`, trois quinzaines montrées). `agency_share_changed` se tait quand l'une des deux quinzaines a moins de 20 de net dans sa devise (`AGENCY_SHARE_CHANGE_MIN_NET_MINOR`).
Pas fait : rien de PAY-04.
Décisions : coordinateur et Agent (16/11 05h22) : pas dans Suivi › Alertes, qui lit les événements des conversations ouverts aux managers et chatteurs. Seuil de 20 : choisi par Charles (16/11 12h18, « fais ce que tu recommandes »). Relecture d'Équipe : lecture bornée par created_at, alerte datée, BasisPointsSchema.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests unitaires scheduling et web ✓, intégration agency-rates et agency-share-check ✓.
