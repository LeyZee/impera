# Runbooks

Procédures d'exploitation, écrites pour être suivies sous stress, par quelqu'un qui n'a pas le contexte. Chaque runbook est testé au moins une fois avant la mise en production (phase 2).

| Runbook | Quand |
|---|---|
| `deploy.md` | Mettre en service, mettre à jour, revenir en arrière (Coolify, Neon) |
| `local-dev.md` | Lancer le CRM sur son PC (base locale, compte, dashboard) |
| `incident.md` | Quelque chose va mal en production (bot qui déraille, envois en double, plateforme qui bloque) |
| `rotate-secrets.md` | Un secret a fuité ou arrive à échéance |
| `restore.md` | Restaurer la base de données |
| `reveal-capture-express.md` | La capture Reveal en une page, pour Charles |
| `reveal-recording.md` | Capturer une session Reveal (HAR) et l'anonymiser avant de la partager (phase 1) |
| `session-expired.md` | La session Reveal est expirée ou invalide |
| `telegram.md` | Une notification Telegram arrive, ou n'arrive plus |
