# 2026-11-27 — OPS-23 Rappel quotidien de reconnexion Reveal — review
Fait : réglage `session_reminder_minute` (migration 0288, 18 h par défaut) et sa route ; `connectors.sessions.clocks()` ; règle `sessionRemindersDue` (heure de l'agence, une heure après, 2 h avant la fin d'un jeton) ; job `alerts.remind_sessions` toutes les 5 minutes vers chaque propriétaire en `agency_alert` ; carte « Reconnexion Reveal » dans Réglages › Alertes › Pilotage ; avenant à l'ADR 0147, runbooks, glossaire.
Découvertes : l'échéance du jeton n'est gardée que dans la session chiffrée, le rappel la relit à chaque passage (quelques comptes, sans coût) ; les notifications de l'agence restent muettes la nuit tant que Charles n'a pas répondu sur le réveil.
Reste : relecture Design de la carte, fusion par Bilan.
