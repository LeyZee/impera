# Opérations : environnements, déploiement, données, observabilité, coûts

Dernière revue : 2026-11-20 (hébergement : ADR 0152).

## Environnements

| Env       | Où                  | Connecteur                                                    | LLM                                 | Base                                                                                                   |
| --------- | ------------------- | ------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `dev` | laptop | `FakeConnector` / `FakeReveal` | clés de test, plafonds bas, ou mock | Postgres local (`docker compose up -d`, rôles créés par `packages/db/docker/init.sql`) |
| `staging` | aucun | — | — | aucune : pas de pré-production avec des données réelles (ADR 0152 § 6) |
| `prod` | VPS Hostinger, Coolify | `RevealApiConnector` | clés prod, plafonds | Supabase, le projet des essais vidé à la mise en ligne, aucun outil sur le compte, pooler en mode session (ADR 0152 § 2 et § 9) |

Règle : le code ne connaît l'environnement que par la config (`apps/api/src/config.ts` : schéma Zod sur `process.env`, chargé par le composition root au démarrage, validé, immuable, échec explicite si une variable manque). Un seul `.env.example` à la racine. Aucune condition `if (env === 'prod')` dans le domaine.

## Déploiement

- Coolify sur le VPS Hostinger déploie `docker-compose.prod.yml` (ADR 0027, ADR 0152) : `migrate`, `api`, `worker` (une image, `apps/api/Dockerfile`), `web` (nginx, `apps/web/Dockerfile`) et `backup`, depuis `main` seulement, déclenché par Charles (aucun webhook public, aucun aperçu de PR) ; `langfuse` à part. Rollback = redéployer l'image précédente. `web` est la seule entrée publique et renvoie `/v1/` vers l'API (même origine) : `TRUST_PROXY_HOPS=2`. Procédures : `docs/runbooks/deploy.md`.
- **Migrations** : exécutées par le service `migrate` du compose avant le démarrage de la nouvelle version (`api` et `worker` attendent qu'il ait réussi), jamais au boot de l'API. Pattern expand/contract : on ajoute (colonne nullable, nouvelle table), on déploie le code qui écrit les deux, on migre les données, on retire l'ancien dans une version suivante. Jamais de `DROP`/`ALTER ... NOT NULL` dans la même version que le code qui en dépend.
- **Arrêt gracieux des workers** : `SIGTERM` → on ne prend plus de job, on finit le job en cours (borné à 25 s, sous le délai de 30 s avant `SIGKILL` de Docker/Coolify), on ferme le pool, on sort avec le code 0.
- **Plantage** : une erreur que personne n'a attrapée, ou une promesse rejetée sans suite, est écrite dans le journal structuré (`process crashed`, niveau `fatal`, avec son origine et sa pile, jamais une valeur) avant que Node n'arrête le processus (`apps/api/src/crash.ts`, API et worker). Avec Sentry, elle y est envoyée avant que le processus ne sorte avec 1, 2 s d'attente au plus (`observability/crash-reports.ts`, § Observabilité). Rien n'est arrêté proprement dans ce cas : l'état du processus est inconnu, Docker relance le conteneur et les verrous du worker mort sont rendus comme ci-dessous.
- **Verrous d'un worker mort** : un worker tué (`SIGKILL`, plantage, machine perdue) laisse ses jobs et leur file (`conv:…`, `account:…`) verrouillés ; Graphile ne les rendrait qu'au bout de 4 h, et la conversation ou le compte resterait muet d'ici là (recette MOT-02). Chaque worker écrit son battement sous l'identifiant de son pool Graphile, celui que porte `locked_by`, et libère toutes les minutes (`graphile_worker.force_unlock_workers`) les verrous de plus de 5 minutes dont le pool n'a pas battu depuis 5 minutes. `/ready` donne leur nombre (`orphanedJobs`) sans passer « non prêt » : un nombre qui reste au-dessus de 0 dit qu'aucun worker ne tourne pour les libérer. Pendant un déploiement progressif, un worker de l'ancienne version bat sous un autre identifiant : ses jobs de plus de 5 minutes peuvent être rendus et rejoués, ce que leur idempotence permet.
- **Jobs abandonnés** : Graphile supprime un job qui réussit, jamais un job qui a épuisé ses tentatives. Sa charge utile resterait sans fin dans `graphile_worker._private_jobs`, hors RLS, et elle peut porter ce qu'une personne a écrit (la note d'un chatteur sur un fan, `conversation.record_facts`). Chaque worker supprime donc, au démarrage puis toutes les heures, les jobs abandonnés depuis plus de 30 jours (`purgeDeadJobs`, `apps/api/src/dead-jobs.ts`), jamais un job verrouillé. D'ici là, le Dashboard et `/ready` les montrent.
- **Image Docker de l'API/worker** : Node 22 + `ffmpeg`, `dist/` construit par tsup avec les paquets du dépôt embarqués (`apps/api/tsup.config.ts`), migrations et prompts copiés là où le code les lit ; le job CI `images` la construit et la démarre à chaque PR (extraction de frames et transcription pour `media`, phase 3). Au démarrage, l'API vérifie que `ffmpeg` et `ffprobe` répondent (`missingMediaBinaries`, module `media`) : s'il en manque un, le journal le dit (« ffmpeg missing ») et l'API démarre quand même ; seules les vidéos et notes vocales des fans ne peuvent pas être lues.
- **Santé** : `/health` (vivant), `/ready` (base joignable, migrations à jour, worker vu récemment). Coolify redémarre sur échec. Un service extérieur surveille `/healthz` du nginx (`deploy.md` § 1.6). Comme toutes les alertes de l'application passent par le worker et la base, le worker bat aussi vers un service extérieur (`WORKER_HEARTBEAT_URL`, `apps/api/src/heartbeat-ping.ts`, OPS-22) : au plus une fois par minute, après un battement écrit en base, jamais quand l'écriture échoue ; le silence (worker arrêté, figé ou coupé de la base) fait écrire ce service au propriétaire.
- **Budget de connexions** (ADR 0152 § 2) : derrière le pooler de Supabase en mode session, chaque connexion d'un processus tient une connexion du pool du projet. Chaque processus a trois pools réglables (`DATABASE_POOL_MAX`, `DATABASE_SERVICE_POOL_MAX`, qui porte aussi Graphile Worker, et `RATE_LIMIT_POOL_MAX` ; 10, 5 et 3 par défaut) et écrit leur somme au démarrage. La « Pool Size » de Supavisor vaut pour chaque rôle : `nirvana_app` (pools applicatif et limiteur de `api` et `worker`), `impera_service` (pools de service de `api` et `worker`) et `nirvana_admin` (`migrate`, `backup`) restent chacun dessous, et leur somme sous le plafond global de la taille de calcul. Le pool de service du worker, qui porte Graphile Worker, vaut `WORKER_CONCURRENCY` + 3 (`WORKER_DATABASE_SERVICE_POOL_MAX`, 8 par défaut). Procédure : `deploy.md` § 1.1 étape 9.
- **Base fermée aux rôles de l'hébergeur** : au démarrage en production, l'API et le worker refusent une base où un rôle autre que les nôtres atteint nos schémas, où un objet n'appartient pas au rôle des migrations, ou dont l'adresse distante n'est pas en `sslmode=verify-full` ; les lecteurs de l'hébergeur (`pg_read_all_data`) sont nommés, risque accepté (ADR 0152). `packages/db/supabase/lock-down.sql` se rejoue après chaque mise à jour de Supabase.
- **Jobs abandonnés** : chaque job a un nombre d'essais borné, fixé par tâche dans `JOB_MAX_ATTEMPTS` (`packages/contracts/src/jobs.ts`) : 1 pour la plupart des jobs périodiques, 3 pour les jobs de conversation, de connecteur, de fan et de média, 5 pour `payroll.recalculate`, 10 pour `telegram.flush_chat` et 25 pour `telegram.scan` (idempotent, aussi mis en file par le déclencheur de `domain_events`) ; au-delà, Graphile le garde dans `graphile_worker.jobs` avec sa dernière erreur. `/ready` en donne le nombre (`deadJobs`) sans passer « non prêt » ; on les lit avec `select task_identifier, last_error from graphile_worker.jobs where attempts >= max_attempts`. Un contenu de job invalide échoue de la même façon, autant de fois que sa tâche a d'essais. Le Dashboard compte aussi comme bloqués (`jobs.dead`) les jobs en retard de 15 minutes dont aucune tâche du worker ne porte le nom (aujourd'hui `fans.refresh_summary`, `media.describe` : le type `JobWithoutTask` du composition root, que le typage oblige à tenir à jour, une tâche oubliée ne compilant pas) : Graphile les garde en file sans jamais consommer d'essai. Le Dashboard d'une créatrice nomme chaque tâche bloquée par son libellé (`JOB_LABELS`), jamais par son identifiant (recette du 05/11, PRO-10). Seules comptent dans la santé de son agent les siennes et la lecture des comptes Reveal (`AGENT_SYSTEM_JOBS`) ; une autre tâche d'aucune créatrice (paie, Telegram, sauvegardes) n'est montrée qu'au propriétaire, en ligne « Agence · … », sans colorer la carte.

## Données

- Sauvegardes : la sauvegarde du jour de Supabase (sans PITR, option payante non prise) + export logique quotidien chiffré, la sauvegarde de référence, (`age`, clé publique) vers un bucket Hetzner Object Storage verrouillé, rétention 30 j : service `backup`, ADR 0028, `deploy.md` § 4. Médias : bucket avec versioning.
- **Restauration testée** une fois par trimestre, sur une base jetable du PC (`restore.md` § C).
- Rétention et purge : jobs quotidiens (faits expirés, médias fan expirés, traces Langfuse > 30 j, `llm_calls` > 90 j agrégés).
- Croissance : `conversation_events` et `messages` partitionnés par mois quand on dépasse ~10 M de lignes (pas avant). Index de départ : liste dans `data-model.md` (§ Index de départ), qui fait foi.

## Observabilité

Trois outils, pas plus :

1. **pino** → stdout → logs Coolify (rétention courte). Structuré, avec `requestId` (= `correlationId`, propagation décrite dans `docs/conventions/coding.md` § Logs), `creatorId`, `conversationId`, `jobId`, `traceId`. Jamais de contenu de message, jamais de session.
2. **Sentry** : les erreurs de l'API, du worker et du dashboard, jamais la performance, avec release = SHA du commit (détail ci-dessous).
3. **Langfuse** : chaque appel LLM (rôle, modèle, version du prompt, tokens, coût, latence, lien vers la conversation), datasets d'éval, scores.

### Sentry : ce qui part, ce qui ne part jamais (OPS-18)

Le dépôt est public et l'application porte les messages intimes des fans et l'argent des créatrices : Sentry ne reçoit que de quoi trouver une panne, jamais de quoi reconnaître quelqu'un.

- **Où** : un projet Sentry de la région UE (`de.sentry.io`), créé par Charles. `SENTRY_DSN` est obligatoire en production (l'API et le worker refusent de démarrer sans, `config.ts`) ; vide ailleurs, le SDK ne démarre pas et rien ne sort de la machine. Le DSN ne s'écrit que dans Coolify, jamais dans le dépôt.
- **Quoi** : une réponse 5xx de l'API (jamais une 4xx, la faute du client), chaque essai raté d'un job (son identifiant de tâche et son numéro d'essai, jamais sa charge utile), une erreur que personne n'a attrapée ou une promesse rejetée sans suite (envoyée, puis le processus sort avec 1 après 2 s au plus ; sans Sentry, Node garde son comportement), et les erreurs du dashboard. Les envois en attente partent à l'arrêt gracieux, bornés à 2 s.
- **Le dashboard** n'embarque aucun SDK ni aucun DSN : il dit ses erreurs (non attrapées, promesses rejetées, écran qui ne s'affiche pas) à l'API, `POST /v1/client-errors`, session requise, même origine, 12 par compte et par quart d'heure sur les compteurs partagés, 5 par chargement de page côté navigateur. Le rapport porte le message (300 caractères), la pile (4 000), le modèle de la route (`/equipe/$memberId`, jamais l'adresse) et la release ; l'API le transmet par le même nettoyage, étiqueté `service=web`, et répond 204, Sentry ou pas. La release de l'événement est celle de l'API ; celle que dit le navigateur n'est qu'une étiquette, `web_release`.
- **Ce qui part** d'une erreur : son type, son message réduit comme dans les journaux (`storableError` : sans les valeurs d'une requête SQL) puis nettoyé, ses frames (fichier relatif au dépôt, fonction, ligne, colonne), la release, l'environnement, le nom et la version de Node et du système, et les seules étiquettes `service` (`api`, `worker` ou `web`), `route`, `task`, `attempt` et `web_release` ; pour une requête, sa méthode et le modèle de sa route (`/v1/fans/:fanId`).
- **Ce qui ne part jamais** : le corps, la requête (`?…`), l'adresse demandée, les en-têtes et les cookies d'une requête ; l'utilisateur ; les extras, le fil d'Ariane (aucun), les variables locales et les lignes de code autour des frames ; le nom de la machine, les modules ; la charge utile d'un job ; aucune trace de performance. Dans le texte qui reste (message, étiquette), ce qui ressemble à une adresse e-mail, une URL, un jeton bearer, un jeton opaque ou une longue suite de chiffres est remplacé (`[email]`, `[url]`, `[token]`, `[number]`), tout ce que le message d'une erreur cite entre guillemets (`"…"`, `'…'`, `` `…` ``, `« … »`, `“…”`, `‘…’`, un guillemet jamais refermé jusqu'à la fin) et la valeur d'une clé en double de Postgres (`Key (col)=(…)`) deviennent `[texte]`, sauf un identifiant d'un seul mot de 40 caractères au plus (`reading 'foo'` reste lisible), et chaque message est coupé à 300 caractères ; les identifiants UUID d'Impera restent entiers. Ces nettoyages lisent le texte en une passe : un message hostile de 10 000 caractères ne bloque rien. Reste un risque, que seule la règle de `coding.md` couvre : une prose sans guillemets écrite par notre code dans un message d'erreur.
- **Comment c'est tenu** : aucune intégration par défaut du SDK (aucune ne lit une requête, un corps ou la console), toutes les catégories de `dataCollection` éteintes, et un `beforeSend` (`apps/api/src/observability/scrub.ts`) qui reconstruit chaque événement à partir d'une liste blanche au lieu de retirer ce qu'il connaît : un champ que le SDK ajouterait demain ne part pas. Un événement qui ne se reconstruit pas ou ne se sérialise pas est abandonné. Un test envoie une erreur pendant une requête dont le corps, la requête et les en-têtes portent un message de fan, un cookie et une adresse e-mail, et lit ce qu'aurait reçu Sentry (`error-reporting.test.ts`).

Et un **tableau de bord opérationnel** dans `apps/web` alimenté par des vues SQL (pas un outil de plus), avec les métriques de la doc §8 :

| Métrique                                           | Source                                         | Cible v1                |
| -------------------------------------------------- | ---------------------------------------------- | ----------------------- |
| Latence de détection (message plateforme → ingéré) | `messages.platform_created_at` vs `created_at` | p95 < 60 s              |
| Latence de génération (job → draft)                | `conversation_events`                          | p95 < 30 s              |
| Latence totale (fan → envoi)                       | idem                                           | médiane < 2 min en auto |
| Taux d'envoi vérifié                               | `message_sent` / `send_attempted`              | > 99,5 %                |
| Messages perdus (réconciliation)                   | job de réconciliation                          | 0                       |
| Doublons                                           | contrainte unique (compte)                     | 0                       |
| Taux d'intervention humaine                        | drafts édités ou rejetés / total               | < 30 % en phase 5       |
| Coût LLM par conversation et par jour              | `llm_calls`                                    | suivi, plafond          |
| Qualité conversationnelle                          | scores du juge (`pnpm evals`) + notes humaines | seuil fixé avec Messa   |

## Coûts et coupe-circuits

- Budget LLM par créatrice et par jour (config), compteur dans `llm_calls` ; au-delà : le bot passe en copilote et alerte.
- Plafonds côté fournisseurs (hard limits mensuels).
- Alerte si dépense horaire > 2× la médiane des 7 derniers jours.
- Rapport hebdomadaire de coût dans le dashboard.

## Temps

- Tout en UTC en base (`timestamptz`). Affichage et règles métier (horaires de persona, cooldowns « ce soir ») en `Europe/Paris` via la config de la créatrice (`creators.timezone`). Bibliothèque : `@date-fns/tz` ou `Temporal` quand stable en Node 22 (polyfill acceptable).
- Les heures de « vie » de la persona sont une donnée de persona, avec jitter, jamais une constante.

## Fournisseurs externes : règles de bonne conduite

- Vers Reveal : jamais plus vite qu'un humain (délais, jitter), repli exponentiel sur erreur, coupe-circuit après N erreurs consécutives (arrêt des appels 10 min + alerte), un seul client par compte, User-Agent et en-têtes cohérents avec le vrai client.
- Vers les LLM : timeouts explicites (sens 60 s, cerveau 45 s, voix 30 s), retries bornés, fallback de fournisseur par rôle, cache des descriptions de médias (jamais deux fois le même média).
