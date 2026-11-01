# 2026-10-22 — Le Dashboard demande un humain après un envoi échoué pour de bon (R-G5) — done

Fait : une conversation en `error` (envoi échoué pour de bon, `send_failed` final) apparaît dans « À traiter » (nature `send_failed`, ton ambre), depuis l'heure du dernier `send_failed` : « Un message n'a pas pu partir. L'agent ne réessaie plus, un humain doit le renvoyer. » L’écran l’appelle « Envoi échoué », sur le Dashboard comme dans Suivi (`todoLabel`).

Pas fait : l'alerte Telegram (fil Telegram, sur l'événement `send_failed` avec `isFinal`).

Décisions : ambre et non rouge (rien de grave pour le fan, rouge réservé aux urgences) ; contrat `DashboardTodoSchema.kind` élargi (accord de Bilan sur la PR), libellé dans `apps/web` (accord d'Extension).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test` (domaine de `supervision`, libellé web) ; intégration en CI (pas de Docker ici).
