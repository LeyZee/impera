# 2026-11-03 — Journal d'accès du proxy et liens de calendrier (ops, suite de CR-12) — done
Fait : contrôle des trois couches qui voient `/v1/calendar-feed/<jeton>.ics`. API : la route journalise à partir de `warn` seulement, et les erreurs ne portent pas l'URL. `nginx` de `web` : `access_log off`, rien à changer. Traefik de Coolify : il n'écrit un journal d'accès que si « Traffic analytics » est actif sur le serveur, et Coolify retire alors toute option `--accesslog…` ajoutée à la main (lu dans `bootstrap/helpers/proxy.php` du dépôt de Coolify, branche `main`, le 03/11/2026). Ajout de l'étape 5 de `docs/runbooks/deploy.md` § 1.2 : laisser l'analyse désactivée, retirer `RequestPath` et `RequestLine` si un journal a été ajouté à la main, avec la commande de vérification.
Pas fait : rien dans le dépôt ne règle le proxy, qui vit dans Coolify ; le geste reste celui du déploiement.
Décisions : retirer le chemin de toutes les lignes plutôt que de couper tout le journal, parce que Traefik n'a pas de filtre par chemin.
Découvertes : même contrôle pour les adresses signées de PUB-02 (déjà noté dans sa fiche).
Candidats à suppression : aucun.
Vérifié : `pnpm check` ✓.
