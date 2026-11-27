# OPS-23 Rappel quotidien de reconnexion Reveal
Statut : review
Phase : exploitation
Dépend de : TG-01 (alertes de l'agence en notifications Impera), OPS-22
Branche : claude/project-thread-v4lgkv (branche imposée par la session)

## Objectif
Le jeton Reveal de l'IA meurt 24 h après la connexion et rien ne le renouvelle. Chaque jour, à une heure que l'agence règle, les propriétaires sont prévenus de reconnecter le compte « bot » et de synchroniser, pour que l'IA ne s'arrête pas faute d'un geste oublié (décision de Charles du 27/11/2026, audit de robustesse R3).

## Contexte à lire
ADR 0147 et son avenant du 27/11, ADR 0176 § 3, `docs/runbooks/session-expired.md`, `apps/api/src/modules/connectors/domain/session-life.ts`, `apps/api/src/modules/alerts/application/agency.ts`.

## À faire
- [x] Réglage `scheduling_settings.session_reminder_minute` (migration 0288) : 18 h par défaut, jamais éteint ; `GET/PUT /v1/scheduling/session-reminder` (lu par l'agence, écrit par le propriétaire, audité).
- [x] `connectors.sessions.clocks()` : chaque compte qui tient une session, avec l'échéance lue dans le jeton, jamais la session.
- [x] Règle pure `sessionRemindersDue` : à l'heure, pour un jeton à moins de 20 h, expiré ou sans échéance lisible ; une fois de plus une heure après ; 2 h avant la fin d'un jeton, sauf si l'heure du rappel tombe dans ces 2 h.
- [x] Job `alerts.remind_sessions` toutes les 5 minutes, à chaque propriétaire, motif `agency_alert` (hors plafond, retenu en heures calmes), clé par compte et jour ou par jeton.
- [x] Carte « Reconnexion Reveal » dans Réglages › Alertes › Pilotage.
- [x] Avenant à l'ADR 0147, runbooks `session-expired.md` et `alerts.md`, glossaire.

## Critères d'acceptation
- Tests unitaires de la règle (heure, relance, veille d'expiration, jour d'un rappel après minuit, textes et longueurs), du job (tous les propriétaires, un échec n'arrête pas les autres), de `clocks()` (sans session ni valeur de session) et de la carte.
- Test d'intégration : 18 h par défaut, écriture par le propriétaire seul, bornes, ligne d'audit.

## Hors périmètre
Réveiller la nuit pour une session qui expire (question posée à Charles, sans réponse) ; la connexion automatique à Reveal par le serveur (à reparler après une à deux semaines réelles, sur son mot écrit).
