# 2026-11-03 — Alerte Telegram quand la vérification des ventes ne concorde plus (CRM-04 b3, côté Telegram) — done
Fait : `sales_feed_mismatch` lu par le scan (plateforme, quinzaine, nombre de jours et de comptes ; ni nets ni écarts) et rendu en « Important », sans créatrice, fil `mismatch:<plateforme>:<quinzaine>`, lien Réglages › Ventes. Migration 0097 (numéro du coordinateur) : le déclencheur `domain_events_telegram_scan` prend `sales_feed_mismatch` et, d'avance, `connection_state_changed` (P3-12 lot 2). ADR 0020 § 3, README, fiche CRM-04. Vérifié : tests domaine, infra et intégration (une seule alerte, aucun montant dans le texte, liste du déclencheur = SCANNED_EVENT_TYPES).
Décisions : aucun montant dans le message (un groupe Important peut compter des managers ; Telegram ne donne jamais un chiffre lié à la paie).
Pas fait : rien pour ce lot.
Découvertes : aucune.
