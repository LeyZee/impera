# Opérations : environnements, déploiement, données, observabilité, coûts

Dernière revue : 2026-10-27.

## Environnements

| Env | Où | Connecteur | LLM | Base |
|---|---|---|---|---|
| `dev` | laptop | `FakeConnector` / `FakeReveal` | clés de test, plafonds bas, ou mock | Postgres local (`docker compose up -d`, rôles créés par `packages/db/docker/init.sql`) ou branche Neon |
| `staging` | VPS, Compose séparé | `FakeReveal` par défaut ; compte Reveal de test si disponible | clés de test | branche Neon `staging` |
| `prod` | VPS | `RevealApiConnector` | clés prod, plafonds | Neon `main` |

Règle : le code ne connaît l'environnement que par la config (`apps/api/src/config.ts` : schéma Zod sur `process.env`, chargé par le composition root au démarrage, validé, immuable, échec explicite si une variable manque). Un seul `.env.example` à la racine. Aucune condition `if (env === 'prod')` dans le domaine.

## Déploiement

- Coolify sur le VPS déploie `docker-compose.prod.yml` (ADR 0027) : `migrate`, `api`, `worker` (une image, `apps/api/Dockerfile`) et `web` (nginx, `apps/web/Dockerfile`), sur push de `main` après CI verte ; `langfuse` à part. Rollback = redéployer l'image précédente. `web` est la seule entrée publique et renvoie `/v1/` vers l'API (même origine) : `TRUST_PROXY_HOPS=2`. Procédures : `docs/runbooks/deploy.md`.
- **Migrations** : exécutées par le service `migrate` du compose avant le démarrage de la nouvelle version (`api` et `worker` attendent qu'il ait réussi), jamais au boot de l'API. Pattern expand/contract : on ajoute (colonne nullable, nouvelle table), on déploie le code qui écrit les deux, on migre les données, on retire l'ancien dans une version suivante. Jamais de `DROP`/`ALTER ... NOT NULL` dans la même version que le code qui en dépend.
- **Arrêt gracieux des workers** : `SIGTERM` → on ne prend plus de job, on finit le job en cours (borné à 25 s, sous le délai de 30 s avant `SIGKILL` de Docker/Coolify), on ferme le pool, on sort avec le code 0. Graphile Worker gère les jobs orphelins par verrou expirant.
- **Image Docker de l'API/worker** : Node 22 + `ffmpeg`, `dist/` construit par tsup avec les paquets du dépôt embarqués (`apps/api/tsup.config.ts`), migrations et prompts copiés là où le code les lit ; le job CI `images` la construit et la démarre à chaque PR (extraction de frames et transcription pour `media`, phase 3). Au démarrage, l'API vérifie que `ffmpeg` et `ffprobe` répondent (`missingMediaBinaries`, module `media`) : s'il en manque un, le journal le dit (« ffmpeg missing ») et l'API démarre quand même ; seules les vidéos et notes vocales des fans ne peuvent pas être lues.
- **Santé** : `/health` (vivant), `/ready` (base joignable, migrations à jour, worker vu récemment). Coolify redémarre sur échec.
- **Jobs abandonnés** : chaque job a un nombre d'essais borné, fixé par tâche dans `JOB_MAX_ATTEMPTS` (`packages/contracts/src/jobs.ts`) : 1 pour la plupart des jobs périodiques, 3 pour les jobs de conversation, de connecteur, de fan et de média, 5 pour `payroll.recalculate`, 10 pour `telegram.flush_chat` et 25 pour `telegram.scan` (idempotent, aussi mis en file par le déclencheur de `domain_events`) ; au-delà, Graphile le garde dans `graphile_worker.jobs` avec sa dernière erreur. `/ready` en donne le nombre (`deadJobs`) sans passer « non prêt » ; on les lit avec `select task_identifier, last_error from graphile_worker.jobs where attempts >= max_attempts`. Un contenu de job invalide échoue de la même façon, autant de fois que sa tâche a d'essais. Le Dashboard compte aussi comme bloqués (`jobs.dead`) les jobs en retard de 15 minutes dont aucune tâche du worker ne porte le nom (aujourd'hui `fans.refresh_summary`, `media.describe` : le type `JobWithoutTask` du composition root, que le typage oblige à tenir à jour, une tâche oubliée ne compilant pas) : Graphile les garde en file sans jamais consommer d'essai.

## Données

- Sauvegardes : Neon PITR (7 j minimum) + export logique quotidien chiffré (`age`, clé publique) vers un bucket Hetzner Object Storage verrouillé, rétention 30 j : service `backup`, ADR 0028, `deploy.md` § 4. Médias : bucket avec versioning.
- **Restauration testée** une fois par trimestre sur `staging` (fiche `H-xx`). Procédure dans `docs/runbooks/restore.md`.
- Rétention et purge : jobs quotidiens (faits expirés, médias fan expirés, traces Langfuse > 30 j, `llm_calls` > 90 j agrégés).
- Croissance : `conversation_events` et `messages` partitionnés par mois quand on dépasse ~10 M de lignes (pas avant). Index de départ : liste dans `data-model.md` (§ Index de départ), qui fait foi.

## Observabilité

Trois outils, pas plus :

1. **pino** → stdout → logs Coolify (rétention courte). Structuré, avec `requestId` (= `correlationId`, propagation décrite dans `docs/conventions/coding.md` § Logs), `creatorId`, `conversationId`, `jobId`, `traceId`. Jamais de contenu de message, jamais de session.
2. **Sentry** : erreurs et performance API/worker, avec release = SHA du commit.
3. **Langfuse** : chaque appel LLM (rôle, modèle, version du prompt, tokens, coût, latence, lien vers la conversation), datasets d'éval, scores.

Et un **tableau de bord opérationnel** dans `apps/web` alimenté par des vues SQL (pas un outil de plus), avec les métriques de la doc §8 :

| Métrique | Source | Cible v1 |
|---|---|---|
| Latence de détection (message plateforme → ingéré) | `messages.platform_created_at` vs `created_at` | p95 < 60 s |
| Latence de génération (job → draft) | `conversation_events` | p95 < 30 s |
| Latence totale (fan → envoi) | idem | médiane < 2 min en auto |
| Taux d'envoi vérifié | `message_sent` / `send_attempted` | > 99,5 % |
| Messages perdus (réconciliation) | job de réconciliation | 0 |
| Doublons | contrainte unique (compte) | 0 |
| Taux d'intervention humaine | drafts édités ou rejetés / total | < 30 % en phase 5 |
| Coût LLM par conversation et par jour | `llm_calls` | suivi, plafond |
| Qualité conversationnelle | scores du juge (`pnpm evals`) + notes humaines | seuil fixé avec Messa |

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
- Vers les LLM : timeouts explicites (sens 60 s, cerveau 30 s, voix 30 s), retries bornés, fallback de fournisseur par rôle, cache des descriptions de médias (jamais deux fois le même média).
