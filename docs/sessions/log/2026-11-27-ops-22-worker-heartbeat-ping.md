# 2026-11-27 — OPS-22 Un worker arrêté se voit de l'extérieur — review
Fait : `WORKER_HEARTBEAT_URL` (facultative, https en production), ping du worker au plus une fois par minute après un battement écrit en base, tests unitaires, `deploy.md` § 1.6, `operations.md`, `.env.example`.
Découvertes : sur main, les alertes système ne vont qu'aux groupes Telegram (#1052 les passe en notifications) ; l'avertissement 2 h avant l'expiration du jeton Reveal n'est pas poussé, et l'expiration est muette la nuit (rappel quotidien décidé par Charles, à faire après #1052) ; une pause répétée du coupe-circuit Reveal n'est dite qu'au Dashboard.
Reste : contrôle à créer chez le service de surveillance par Charles.
