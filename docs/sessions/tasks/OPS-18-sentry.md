# OPS-18 Les erreurs de production arrivent dans Sentry, sans rien de personnel
Statut : done
Phase : exploitation
Dépend de : OPS-01 (déploiement), `docs/architecture/operations.md` § Observabilité
Branche : task/ops-18-sentry

## Objectif
Une panne de l'API, du worker ou du dashboard en production se voit dans Sentry, et rien de ce qu'écrit un fan, ni l'argent d'une créatrice, ni qui que ce soit n'y part.

## Contexte à lire
`docs/architecture/operations.md` (§ Observabilité), `docs/conventions/security.md` § 6, `apps/api/src/config.ts`, `apps/api/src/server.ts` (gestionnaire d'erreurs), `apps/api/src/worker-runner.ts`, `apps/api/src/crash.ts`, `apps/api/src/shutdown.ts`, `apps/api/src/rate-limit-store.ts`, les balayages `authentication-sweep` et `origin-sweep`.

## À faire
- [x] `@sentry/node` 11.11.0 dans `apps/api` (seule dépendance nouvelle, passée la quarantaine de 14 jours ; `glob` et `minimatch` de son arbre ramenés à des versions qui l'ont passée).
- [x] `SENTRY_DSN` dans `config.ts` : facultatif, DSN https (`https://<clé>@<hôte>/<projet>`), obligatoire en production ; sans lui, aucun client, aucun réseau.
- [x] Démarrage sans intégration par défaut, `dataCollection` tout éteint (l'équivalent de `sendDefaultPii: false` depuis Sentry 11), `tracesSampleRate: 0`, `maxBreadcrumbs: 0`, `includeLocalVariables: false`, release et environnement.
- [x] `beforeSend` (`observability/scrub.ts`) : événement reconstruit sur liste blanche, étiquettes `service`, `route`, `task`, `attempt`, contextes `runtime` et `os`, requête réduite à sa méthode et au modèle de sa route, messages coupés à 300 caractères et nettoyés (e-mail, URL, jeton bearer ou opaque, longue suite de chiffres), événement abandonné s'il ne se reconstruit pas.
- [x] Points de capture : 5xx du gestionnaire d'erreurs Fastify, essai raté d'un job (tâche et essai, jamais la charge utile), erreur non attrapée et promesse rejetée sans suite, vidage borné à l'arrêt gracieux.
- [x] Dashboard : aucun SDK ni DSN ; erreurs non attrapées, promesses rejetées et écran d'erreur du routeur envoyés à `POST /v1/client-errors` (session, origine, schéma Zod, 12 par compte et par quart d'heure sur les compteurs Postgres, 204) ; release de l'image (`VITE_RELEASE`).
- [x] Docs : `.env.example`, `operations.md` (ce qui part, ce qui ne part jamais), `deploy.md`, `threat-model.md`, `api.md`, README de l'API ; CI et compose de production avec un DSN obligatoire.

## Critères d'acceptation
- Sans `SENTRY_DSN`, le SDK ne démarre pas (`isInitialized()` faux) ; en production, l'API refuse de démarrer sans.
- Une erreur levée pendant une requête dont le corps, la requête et les en-têtes portent un message de fan, un cookie et une adresse e-mail n'envoie aucun des trois (test sur transport factice) ; une 4xx n'envoie rien.
- `POST /v1/client-errors` répond 401 sans session, 403 d'une autre origine, 400 hors schéma, 204 sinon, 429 au-delà de sa limite ; les balayages d'authentification et d'origine passent sans exception nouvelle.

## Hors périmètre
La création du compte et du projet Sentry (Charles), la performance et les traces, les cartes de sources (source maps) du dashboard, les alertes de Sentry.

## Notes de session
- 20/11 : la limite de la route est de 12 par quart d'heure, pas 10 par 10 minutes : le magasin partagé nomme un limiteur sans route par ses bornes, et 10/10 min est celui de la reconfirmation (le test d'intégration l'a montré au démarrage).
- La limite est par compte (`request.user.id`), pas par session : la garde ne lit pas l'identifiant de session, et un compte qui ouvre plusieurs sessions garde le même plafond.
- Les 503 et 502 sont aussi envoyés (toute réponse ≥ 500, base indisponible comprise) : une panne de base longue peut en envoyer beaucoup, Sentry les regroupe.
- Relecture Sécurité (#895) : tout segment cité entre guillemets dans le message d'une erreur, et la valeur `=(…)` d'une clé en double de Postgres, devient `[texte]` sauf un identifiant d'un mot ; les nettoyages lisent en une passe (plus aucun motif à retour arrière, pile du navigateur comprise) ; la release d'un rapport du dashboard est celle de l'API, la sienne une étiquette `web_release`. Règle « jamais de texte de fan dans un message d'erreur » dans `coding.md`, risque restant dans `threat-model.md`.

## Résultat
Fait, branche `task/ops-18-sentry`. Reste pour Charles : créer le projet Sentry en région UE et poser `SENTRY_DSN` dans Coolify avant le prochain déploiement (sans lui, le déploiement s'arrête).
