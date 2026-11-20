# Déploiement en production

Mettre Impera en service sur le VPS Hostinger (Coolify) avec la base chez Supabase, le mettre à jour, revenir en arrière. Décisions : ADR 0152 (Hostinger, Supabase, serveur fermé), ADR 0027 (images, compose, limiteur), ADR 0087 (trois rôles en base). Tout ce qui suit se fait dans le panneau Hostinger, Coolify, Supabase et un terminal sur le serveur ; rien ne passe par un fichier du dépôt.

**Pas encore joué** : ces étapes suivent la documentation de Hostinger, de Coolify et de Supabase, les essais faits sur un projet Supabase de test le 20/11 et la répétition locale (§ 6), pas une vraie mise en service. La première mise en service (OPS-19 lot c) les vérifie ; tout écart se corrige ici, dans la même journée.

**Rien de réel dans ce fichier ni ailleurs dans le dépôt** : ni domaine, ni adresse IP, ni nom d'hôte, ni identifiant de projet, ni nom de compte, ni mot de passe. Les exemples disent `<domaine>`, `<ip du serveur>`, `<ref>` ; les vraies valeurs restent chez Charles. Les secrets se génèrent sur son PC et il les saisit lui-même dans Coolify, jamais dans un chat ni dans le dossier partagé.

**Avant la mise en service** : le développement et la CI doivent tourner dans la même version majeure de Postgres que le projet Supabase (17 pour un projet neuf, fiche OPS-20), sinon l'image `backup` ne sait pas exporter la base.

Rien n'envoie à un fan tant que `connector_config.writes` n'est pas ouvert pour son compte (ADR 0018) : une mise en service ne parle à personne.

## Ce qui tourne

| Service | Image | Rôle |
|---|---|---|
| `migrate` | `apps/api/Dockerfile` | applique les migrations, puis s'arrête ; rien d'autre ne démarre s'il échoue |
| `api` | même image | l'API, `/health` et `/ready` |
| `worker` | même image, `node dist/worker.js` | les jobs (Graphile Worker), jamais de HTTP |
| `web` | `apps/web/Dockerfile` | le dashboard, et `/v1/` renvoyé vers l'API : **seul service public** |
| `backup` | `ops/db-export/Dockerfile` | l'export quotidien chiffré hors Supabase, chaque nuit à 3 h (ADR 0028, § 4) |

Le tout est décrit par `docker-compose.prod.yml`. L'API n'a pas de domaine : le navigateur l'atteint par `https://<domaine>/v1/`, à travers le nginx de `web`.

**Réseau sortant de l'API et du worker : les buckets des factures.** Le worker envoie chaque PDF chez Hetzner puis chez OVHcloud, et l'API les relit pour un téléchargement (ADR 0037 ; § 4.3 ci-dessous). Si un hôte est coupé, le job réessaie environ une heure puis alerte le propriétaire ; le téléchargement lit l'autre copie.

**Réseau sortant du worker : la BCE.** Le job `payroll.fetch_exchange_rates` lit chaque heure, à la 7ᵉ minute, les taux de référence de la BCE sur `https://www.ecb.europa.eu` (ADR 0033). La requête part en HTTPS, sans clé, et n'envoie aucune donnée de l'agence. Si un pare-feu coupe cet hôte, le job échoue à chaque passage et n'écrit rien. Les brouillons gardent le dernier taux connu. Une clôture est refusée (`exchange_rate_missing_conflict`) dès que le dernier taux date de plus de quatre jours avant la fin de la quinzaine. Rien n'est payé sur un taux deviné. Quand l'hôte revient, le passage suivant rattrape les jours manqués, sur 90 jours au plus.

**Réseau sortant de l'API : Pwned Passwords.** Quand un mot de passe est choisi (lien d'invitation ou de nouveau mot de passe, `pnpm owner:create`), l'API demande à `https://api.pwnedpasswords.com` s'il circule dans des fuites connues (ADR 0046 § 4). Seuls les 5 premiers caractères de son empreinte SHA-1 sortent, jamais le mot de passe ni l'e-mail. Si un pare-feu coupe cet hôte, aucun mot de passe ne peut être choisi (503, l'écran dit de réessayer) : l'autoriser avant d'inviter l'équipe.

## 1. Première mise en service

Ordre : le serveur (§ 1.0), la base (§ 1.1), Coolify (§ 1.2), les variables (§ 1.3), le premier déploiement (§ 1.4), puis le verrouillage de la base (§ 1.4, étape 2), la persona (§ 1.5), la surveillance (§ 1.6). Charles fait chaque geste chez un fournisseur (commande, compte, secret) ; une session peut le guider pas à pas, sans jamais recevoir un secret.

### 1.0 Le VPS Hostinger

1. **Commande** (Charles) : KVM 2, centre de données dans l'Union européenne au plus près de la région de la base, Ubuntu 24.04 LTS. La double authentification est active sur le compte Hostinger, chez le registraire et chez l'hébergeur DNS : chacun vaut root (console, réinstallation, instantanés).
2. **Clé SSH** : sur le PC, `ssh-keygen -t ed25519`. La clé publique se colle dans le panneau Hostinger à la création (ou dans `~/.ssh/authorized_keys`) ; la clé privée ne quitte pas le PC.
3. **Un compte nommé**, puis plus de root par SSH :

   ```sh
   adduser <compte>
   usermod -aG sudo <compte>
   install -d -m 700 -o <compte> -g <compte> /home/<compte>/.ssh
   cp /root/.ssh/authorized_keys /home/<compte>/.ssh/ && chown <compte>: /home/<compte>/.ssh/authorized_keys
   ```

   Dans un deuxième terminal, vérifier `ssh <compte>@<ip du serveur>` puis `sudo -v` **avant** de fermer le premier. Ensuite, `/etc/ssh/sshd_config.d/10-impera.conf` :

   ```
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   ```

   puis `sudo systemctl reload ssh`.
4. **Essais répétés bloqués** : `sudo apt install fail2ban` (la prison `sshd` est active par défaut sur Ubuntu). `sudo fail2ban-client status sshd` donne les adresses bloquées.
5. **Pare-feu Hostinger** (panneau → VPS → Pare-feu) : c'est lui qui fait foi, car Docker publie ses ports en passant sous le pare-feu du système. Règles entrantes : 22 (TCP), 80 (TCP), 443 (TCP), le reste refusé. Si Charles a une adresse IP fixe, la règle 22 ne vaut que pour elle. Les ports d'administration de Coolify (8000, 6001, 6002) restent **fermés**.
6. **Mises à jour de sécurité automatiques** : `sudo apt install unattended-upgrades` puis `sudo dpkg-reconfigure -plow unattended-upgrades`, et dans `/etc/apt/apt.conf.d/50unattended-upgrades` : `Unattended-Upgrade::Automatic-Reboot "true";` et `Unattended-Upgrade::Automatic-Reboot-Time "04:30";` (après l'export de 3 h).
7. **Instantanés Hostinger** : désactivés, ou laissés à Hostinger en sachant qu'ils contiennent les secrets de Coolify. Coolify a aussi sa propre sauvegarde (Settings → Backup) : la laisser coupée, ou ne l'envoyer que chiffrée.
8. **Coolify** : installé par le catalogue Hostinger ou par son script officiel (documentation de Coolify, une ligne `curl … | bash` à lire avant de la lancer). Son tableau de bord n'est **jamais** ouvert au public : on y entre par un tunnel SSH, depuis le PC :

   ```sh
   ssh -N -L 8000:127.0.0.1:8000 <compte>@<ip du serveur>
   ```

   puis `http://localhost:8000`. Premier écran : le compte administrateur, avec un mot de passe fort (gestionnaire de mots de passe) ; puis Profile → la double authentification. Coolify tient le socket Docker : son compte vaut root. Dans Settings : pas de domaine pour Coolify lui-même, « Registration » désactivée, mises à jour automatiques de Coolify désactivées (Charles les fait lui-même, sur un rappel).

### 1.1 La base Supabase

**Le projet.** La production est le projet Supabase que Charles a créé pour Impera et qui a servi aux essais (ADR 0152 § 9), sur son plan payant (un projet gratuit se met en pause et plafonne la base à 500 Mo), dans l'Union européenne. Charles est le seul membre de l'organisation, avec la double authentification. Le mot de passe du rôle `postgres` reste dans le gestionnaire de mots de passe et n'entre dans **aucune variable** de Coolify ni d'ailleurs.

**Plus aucun outil sur le compte, avant la première donnée réelle** (Charles, ADR 0152 § 9). Un connecteur s'autorise pour toute une organisation : il ne se rebranche donc **plus jamais** sur celle-ci, ni en lecture seule. Account → Access Tokens : supprimer tout jeton. Organisation → Integrations, et la liste des applications autorisées du compte (OAuth) : retirer tout connecteur d'assistant (MCP) et toute intégration. Un essai qui a besoin de Supabase après la mise en ligne se fait dans un projet temporaire d'une **autre** organisation, supprimé ensuite. Ce geste vient au plus tard juste avant l'étape 5 du § 1.4 (la première créatrice).

1. **Repartir d'une base vide** (Charles, dans le SQL Editor). Les essais ont laissé des rôles, des schémas et des tables. On ne les trie pas à la main : on les liste, puis on les efface en bloc, et les migrations repartent de zéro.

   ```sql
   select rolname from pg_roles where rolname in ('nirvana_admin', 'impera_service', 'nirvana_app');
   select nspname from pg_namespace where nspname in ('drizzle', 'graphile_worker');
   select count(*) from pg_tables where schemaname = 'public';
   select extname, extnamespace::regnamespace from pg_extension order by 1;
   select pubname from pg_publication;
   ```

   La liste va dans le fil Hébergement. **Rien n'est supprimé sans le mot écrit de Charles.** Une fois ce mot donné, il joue lui-même, connecté en `postgres` :

   ```sql
   DROP OWNED BY nirvana_admin, impera_service, nirvana_app CASCADE;
   DROP ROLE nirvana_admin, impera_service, nirvana_app;
   ```

   `DROP OWNED` emporte tout ce que nos rôles possèdent : nos tables de `public`, les schémas `drizzle` et `graphile_worker`, nos fonctions, et leurs droits. Les cinq requêtes sont relancées. Nos rôles, nos deux schémas et nos tables de `public` ont disparu. Ce qui reste (extensions, publications) est celui d'un projet Supabase neuf ; une extension, une fonction, un déclencheur ou une publication qui ne vient ni de Supabase ni de nos migrations part aussi, sur le même mot. Les rôles sont recréés à neuf à l'étape 6, avec des mots de passe jamais utilisés en essai. Après le premier `migrate` (§ 1.4), le contrôle au démarrage refuse tout objet de nos schémas qui n'appartient pas à `nirvana_admin`.
2. **Les restes des essais hors de la base** (Charles) : supprimer les branches Supabase, les fonctions Edge, leurs secrets et les notebooks SQL créés pendant les essais. Project Settings → API Keys : **régénérer** les clés (`anon`, `service_role`, clés publiables et secrètes) et le secret JWT, qui ont été visibles pendant les essais. Lire le journal d'audit de l'organisation (Organization → Audit Logs) : rien d'inattendu depuis la création du projet. Noter la rétention des sauvegardes de Supabase choisie ; les sauvegardes prises pendant les essais ne contiennent aucune donnée réelle, puisque les essais n'en utilisent jamais.
3. **Ce qu'on n'utilise pas** : Project Settings → Data API, désactiver l'API de données (les clés `anon` et `service_role` ne servent alors à rien et ne sont copiées nulle part). Realtime : désactivé. Auth, Storage et Edge Functions : rien n'est configuré, aucune clé n'est sortie du tableau de bord.
4. **TLS et réseau** : Database → Settings → SSL Configuration, « Enforce SSL on incoming connections » **activé**, et télécharger le certificat (`prod-ca-…crt`, public). Database → Settings → Network Restrictions : n'autoriser que l'adresse du serveur, en IPv4 (`<ip du serveur>/32`) et en IPv6 si le VPS en a une (`<ipv6 du serveur>/128`). Les restrictions valent pour la connexion directe comme pour le pooler. Le temps de la mise en service, ou d'une restauration (`restore.md`), Charles ajoute l'adresse de son PC, puis la retire dès la fin ; la liste revient alors à la seule adresse du serveur, et il le vérifie sur la même page.
5. **Première vérification**, dans le SQL Editor (qui se connecte en `postgres`) :

   ```sql
   select rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user;
   select version();
   ```

   Attendu : `f`, `t`, `t` (vu sur un projet de test le 20/11), et la version majeure de la fiche OPS-20. Si `postgres` ne peut pas créer de rôle `BYPASSRLS`, **on s'arrête et on revient à l'ADR 0152**.
6. **Les trois rôles** (ADR 0087), toujours dans le SQL Editor, avec trois mots de passe sortis chacun de `openssl rand -base64 24`, jamais réutilisés, jamais les mêmes qu'en développement :

   ```sql
   CREATE ROLE nirvana_admin  LOGIN PASSWORD '<mot de passe 1>' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
   CREATE ROLE impera_service LOGIN PASSWORD '<mot de passe 2>' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
   CREATE ROLE nirvana_app    LOGIN PASSWORD '<mot de passe 3>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   GRANT CONNECT ON DATABASE postgres TO nirvana_admin, impera_service, nirvana_app;
   GRANT USAGE, CREATE ON SCHEMA public TO nirvana_admin;
   GRANT USAGE ON SCHEMA public TO impera_service, nirvana_app;
   GRANT CREATE ON DATABASE postgres TO nirvana_admin;
   CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
   ```

   `CREATE ON DATABASE` laisse `nirvana_admin` créer le schéma de la file de jobs (`graphile_worker`) et celui du journal des migrations (`drizzle`). `btree_gist` est créée ici par `postgres` : la migration 0021 fait `CREATE EXTENSION IF NOT EXISTS btree_gist` sans pouvoir la créer elle-même, et passe alors sans rien faire. Le serveur et le worker refusent de démarrer si un rôle de connexion a trop de droits ou appartient à un rôle plus puissant (`postgres`), avec un message qui renvoie ici.
7. **Les chaînes de connexion.** Project → Connect → **Session pooler** (port 5432), jamais le mode transaction (port 6543) : Graphile Worker a besoin de `LISTEN/NOTIFY`, que seul le mode session garde. La connexion directe n'existe qu'en IPv6, ce que Docker sous Coolify ne gère pas sans réglage. Le nom d'utilisateur prend la forme qu'impose le pooler, `<rôle>.<ref>` :

   ```
   postgres://nirvana_app.<ref>:<mot de passe 3>@<hôte du pooler>:5432/postgres?sslmode=verify-full&sslrootcert=/data/supabase-ca.crt
   ```

   Même forme pour `DATABASE_SERVICE_URL` (`impera_service`) et `DATABASE_ADMIN_URL` (`nirvana_admin`). En production, l'API et le worker refusent une base distante sans `sslmode=verify-full` (`config.ts`). Le certificat de l'étape 4 se monte dans Coolify (§ 1.2, étape 4).
8. **Vérifier chaque rôle par le pooler**, depuis le PC (si son adresse est autorisée) ou depuis le serveur : `psql "<chaîne du rôle>" -c "select current_user, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user"`. Attendu : `nirvana_admin` à `f, t, f` ; `impera_service` à `f, t, f` ; `nirvana_app` à `f, f, f`.
9. **Le budget de connexions.** En mode session, chaque connexion d'un de nos processus garde une connexion de Supavisor, le pooler de Supabase. Sa « Pool Size » (Database → Settings → Connection pooling) vaut **pour chaque couple rôle et base** : chacun de nos trois rôles a donc ce plafond à lui. S'y ajoute le plafond global de la taille de calcul (`max_connections`, affiché au même endroit), que partagent nos trois rôles et les services de Supabase. Chaque processus écrit son budget au démarrage (« database connection budget of this process » : `app` et `rateLimit` en `nirvana_app`, `service` en `impera_service`). Les trois règles :
   - **`nirvana_app`** : (`DATABASE_POOL_MAX` + `RATE_LIMIT_POOL_MAX`) × 2 (`api` et `worker`) ≤ Pool Size. Défauts : (10 + 3) × 2 = 26.
   - **`impera_service`** : `DATABASE_SERVICE_POOL_MAX` de `api` + celui de `worker` ≤ Pool Size. Graphile Worker tourne sur le pool de service du worker : il lui faut `WORKER_CONCURRENCY` + 3 (une connexion par job en cours, une pour `LISTEN`, de la marge), d'où `WORKER_DATABASE_SERVICE_POOL_MAX`, 8 par défaut pour une concurrence de 5 (`docker-compose.prod.yml`). Défauts : 5 + 8 = 13.
   - **`nirvana_admin`** : `migrate` et `backup`, 2 chacun au plus, et le SQL Editor quand on s'en sert.
   - **Au total** : 26 + 13 + 4 avec les défauts, soit 43, sous `max_connections` moins ce que Supabase garde pour lui (la page des réglages le dit).

   Si un plafond ne tient pas, baisser d'abord `DATABASE_POOL_MAX` et `RATE_LIMIT_POOL_MAX` (§ 1.3), jamais le pool de service du worker sous `WORKER_CONCURRENCY` + 3 (baisser alors `WORKER_CONCURRENCY` avec lui). Monter la taille de calcul est une décision d'argent qui revient à Charles.

**Ce que l'hébergeur garde.** Les rôles de lecture de Supabase (membres de `pg_read_all_data`, comme le rôle en lecture seule de son tableau de bord) lisent toutes nos tables quels que soient nos droits : c'est le risque accepté de l'ADR 0152. Le démarrage les nomme dans les journaux (« roles of the host that read every table »). Un rôle non superutilisateur qui pourrait **écrire** partout est, lui, refusé.

### 1.2 Coolify

1. Coolify → Projet « Impera » → Ressource → **Docker Compose**, depuis le dépôt GitHub `LeyZee/impera`, branche `main`, fichier `docker-compose.prod.yml`, avec une clé de déploiement en **lecture seule** limitée à ce dépôt (le dépôt est public : la clé ne sert qu'à ne pas dépendre d'un compte).
2. Domaine : sur le service **`web` seulement**, port 8080 (`https://app.<domaine>`). Aucun domaine sur `api`, `worker`, `migrate`, `backup`. Le domaine définitif est choisi **avant** : il fixe les clés d'accès et l'adresse intégrée à l'extension.
3. Cocher « Include Source Commit in Build » : `SOURCE_COMMIT` devient le tag de l'image et `RELEASE` (Sentry, battement du worker).
4. **Le certificat de Supabase** : Storages → montage de fichier sur `api`, `worker`, `migrate` et `backup`, chemin `/data/supabase-ca.crt`, contenu = le fichier de § 1.1 étape 4 (public, ce n'est pas un secret).
5. **Pas de déploiement automatique sur webhook** : le tableau de bord de Coolify est fermé, aucun webhook public ne l'atteint. Charles déclenche chaque déploiement (Deploy), ou laisse Coolify interroger le dépôt s'il le propose. **Aucun déploiement d'aperçu pour les PR** (Preview Deployments désactivés) : le dépôt est public, et une PR d'un inconnu construite sur le serveur verrait les secrets du build.
6. **Journal d'accès du proxy.** Le jeton d'un lien de calendrier est dans le chemin (`/v1/calendar-feed/<jeton>.ics`), et quiconque lit ce chemin lit les shifts de son titulaire. L'API ne le journalise pas, et le `nginx` de `web` non plus ; le Traefik de Coolify ne doit pas le garder non plus.
   - Coolify → Servers → le serveur : **laisser « Traffic analytics » désactivé**. Activé, Coolify écrit un journal d'accès JSON (`/traefik/access.log`, chemin, User-Agent et Referer gardés). Tant qu'il est actif, Coolify retire aussi toute option `--accesslog…` ajoutée à la main : on ne peut alors pas en ôter le chemin.
   - Proxy → Configuration : par défaut, la commande de `traefik` n'a aucun `--accesslog`, et rien n'est à faire. Si quelqu'un en a ajouté un pour un dépannage, ajouter sous `command:` les deux lignes suivantes, puis « Save » et « Restart Proxy » (Traefik n'a pas de filtre par chemin : on retire le chemin de toutes les lignes) :

     ```yaml
     - '--accesslog.fields.names.RequestPath=drop'
     - '--accesslog.fields.names.RequestLine=drop'
     ```

   - Désactiver l'analyse remet les `--accesslog…` faits à la main que Coolify avait gardés de côté : après une activation puis une désactivation, repasser par Proxy → Configuration.
   - Le journal général de Traefik (`--log.level`) est autre chose que le journal d'accès : ne pas laisser `--log.level=DEBUG` après un dépannage, car ce niveau écrit les requêtes.
   - Vérifier : ouvrir une fois son propre lien de calendrier, puis, dans Coolify → Servers → le serveur → Terminal, `docker exec coolify-proxy sh -c 'grep -c calendar-feed /traefik/access.log'` doit répondre `0`, ou « No such file » s'il n'y a pas de journal.
   - Si un Cloudflare est mis un jour devant le domaine, ses journaux (Logpush) gardent aussi le chemin : ne pas les activer pour ce domaine, ou en ôter le chemin.

### 1.3 Variables

Toutes dans Coolify → Environment Variables, marquées « secret » quand c'est un secret. La liste de référence est `.env.example` ; en production :

| Variable | Valeur |
|---|---|
| `DATABASE_URL`, `DATABASE_SERVICE_URL`, `DATABASE_ADMIN_URL` | § 1.1 |
| `SESSION_ENCRYPTION_KEYS` | `v1:` + `openssl rand -base64 32` |
| `CREDENTIALS_ENCRYPTION_KEYS` | `v1:` + une **autre** sortie de `openssl rand -base64 32` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_BASE_URL`, `WEB_ORIGIN` | l'URL publique du dashboard, la même pour les deux (`https://app.<domaine>`). Son domaine est celui des clés d'accès (ADR 0053) : le changer rend toutes les clés inutilisables ; chacun se reconnecte avec son mot de passe et son code, puis ajoute une nouvelle clé. `WEB_ORIGIN` est aussi l'adresse intégrée à l'extension que sert le guide (ADR 0067, second amendement) : l'image `web` la reçoit en argument de build ; la changer demande de reconstruire cette image, et chaque membre recharge l'extension téléchargée à nouveau. `EXTENSION_CRM_ORIGIN`, si elle est posée, la remplace pour l'extension et doit nommer le même site, sinon le build échoue ; vide, l'extension n'a pas d'adresse intégrée (la CI, servie en http) |
| `DATABASE_POOL_MAX`, `DATABASE_SERVICE_POOL_MAX`, `RATE_LIMIT_POOL_MAX`, `WORKER_DATABASE_SERVICE_POOL_MAX` | le budget de § 1.1 étape 9 (défauts 10, 5 et 3 par processus ; 8 pour le pool de service du worker) |
| `WORKER_CPUS` | `1` (défaut) : le worker et son ffmpeg laissent un cœur à l'API sur les 2 du KVM 2 ; à revoir en conditions réelles |
| `TRUST_PROXY_HOPS` | `2` (le proxy de Coolify, puis le nginx de `web`) ; défaut du compose, à vérifier sur le vrai serveur (§ 1.4) |
| `PLAYGROUND_PERSONA_PATH` | facultatif : chemin **dans le conteneur** de la persona du playground (§ 1.5) ; démo sans lui. Les brouillons, les gardes et « À apprendre » ne le lisent pas |
| `BACKUP_*` | § 4.1 ; sans elles, l'export de la nuit échoue et l'alerte le signale |
| `S3_*` | § 4.4 ; sans elles, la créatrice ne peut pas envoyer de fichier (l'envoi répond « réessaie dans un moment ») |
| `SENTRY_DSN`, `LANGFUSE_*`, `VAPID_*` | facultatifs, vides tant que le service n'existe pas |

Les clés des services IA (xAI, Google, Mistral, ElevenLabs) ne sont **pas** des variables en production : elles se collent dans Réglages › Modèles IA › Services (ADR 0016). Les deux clés de chiffrement se gardent aussi hors du serveur (gestionnaire de mots de passe) : les perdre rend illisibles les sessions et les clés stockées.

### 1.4 Premier déploiement

1. Coolify → Deploy. Ordre attendu dans les journaux : `migrate` « Migrations applied. » et sort avec 0, puis `api` et `worker`, puis `web`. **Au premier déploiement, `api` et `worker` s'arrêtent** sur « Database not closed to other roles » : c'est attendu, la base n'est pas encore verrouillée.
2. **Verrouiller la base** : dans le SQL Editor de Supabase (donc en `postgres`), coller et lancer `packages/db/supabase/lock-down.sql`, tel qu'il est sur `main`. Il retire à tout rôle autre que les nôtres ce qu'il avait sur nos schémas, et à PUBLIC l'usage de `public`. Le relancer ne change rien ; il se rejoue **après chaque mise à jour de Supabase** (version de Postgres, mise à niveau du projet). Puis Coolify → Restart. Le journal de `api` dit alors seulement « roles of the host that read every table (accepted, ADR 0152) : … », sans avertissement.
3. Vérifier :
   - `https://app.<domaine>/` affiche l'écran de connexion ;
   - Coolify → `api` → Terminal : `wget -qO- http://127.0.0.1:3000/ready` → `"status":"ready"` avec `database`, `migrations` et `worker` à `true` ;
   - le budget de connexions (§ 1.1 étape 9) : la ligne « database connection budget of this process » de `api` et celle de `worker`, et dans Supabase → Database → Settings → Connection pooling, le nombre de connexions du pool reste sous sa taille ;
   - `TRUST_PROXY_HOPS` : après la première connexion au dashboard (étape 5), dans le SQL Editor de Supabase, `select ip from audit_log order by created_at desc limit 1` donne l'adresse IP publique de Charles, et non celle d'un proxy (`10.x`, `172.x`, `192.168.x`). Sinon, corriger la valeur et redéployer avant d'inviter qui que ce soit ;
   - le journal du proxy (§ 1.2 étape 6, dernière vérification).
4. Créer le compte propriétaire (pas d'inscription publique), Coolify → `api` → Terminal :

   ```sh
   node dist/scripts/create-owner.js --email <e-mail> --name <nom>
   ```

   Le mot de passe se tape deux fois, sans écho (12 caractères au moins). L'e-mail, passé en argument, reste dans l'historique du terminal de Coolify : le vider ensuite (`history -c`), le script ne sachant pas encore le demander au clavier.
5. Se connecter au dashboard, créer la créatrice dans Créatrices (ou `node dist/scripts/create-creator.js --name <nom>`).
6. **Changer le mot de passe de `postgres`** une fois la mise en service finie (Database → Settings → Reset database password), et ne le garder que dans le gestionnaire de mots de passe. Retirer l'adresse du PC des restrictions réseau si elle y avait été ajoutée.

### 1.5 Persona réelle

La persona réelle ne vit jamais dans le dépôt (ADR 0010). L'agent écrit avec la version **active** de la persona de la créatrice, en base : ses brouillons, ses relances, les gardes rejouées à l'approbation et « À apprendre » la lisent à chaque appel. Sans version active, l'agent n'écrit rien (passage à un chatteur, cause « Pas de persona active ») et **aucun message ne peut être approuvé** pour elle. Activer une version dans Créatrices › Persona, ou depuis un fichier monté : Coolify → service `api` → Storages → montage de fichier : chemin `/data/persona/persona.yaml`, contenu = le YAML, puis, pour l'enregistrer comme version de la créatrice et l'activer :

```sh
node dist/scripts/persona-validate.js /data/persona/persona.yaml
node dist/scripts/persona-load.js /data/persona/persona.yaml --activate
```

### 1.6 Surveillance

Hors du serveur, pour qu'une panne du VPS se voie (ADR 0152 § 7) :

1. **Disponibilité** : un service de surveillance extérieur, gratuit au départ (UptimeRobot, ou un équivalent que Charles préfère), interroge toutes les 5 minutes `https://app.<domaine>/healthz` (le nginx de `web`, mot-clé `ok`) et prévient Charles par e-mail ou Telegram. Le compte du service a la double authentification ; il ne connaît que l'adresse publique. `/health` et `/ready` de l'API ne sont pas exposés par nginx : tant qu'ils ne le sont pas, une API arrêtée derrière un `web` vivant se voit dans Coolify (statut du service, redémarrages) et par les alertes de l'application, pas par ce service.
2. **Disque** : Coolify → Notifications (e-mail ou Telegram), puis Servers → le serveur → seuil d'alerte du disque à 80 %. Les vidéos du worker demandent 30 Go libres (§ 4.4).
3. **Connexions SSH refusées** : `sudo fail2ban-client status sshd` à chaque revue hebdomadaire ; un nombre d'adresses bloquées qui s'envole, ou une connexion réussie inconnue dans `last -a`, se traite comme un incident (`incident.md`).
4. Charles met Coolify à jour lui-même (rappel mensuel), après avoir lu ses notes de version.

## 2. Mettre à jour

Charles déclenche le déploiement après la fusion d'une PR dans `main` (Coolify → Deploy ; pas de webhook, § 1.2). Puis vérifier : Coolify → Deployments → dernier statut, et `/ready`.

- Les migrations passent avant le nouveau code (`migrate`), en expand/contract (`operations.md`) : l'ancien code tourne encore sur le nouveau schéma pendant la bascule.
- Un `migrate` en échec arrête le déploiement : l'ancienne version reste en ligne. Lire son journal, corriger par une nouvelle PR. Ne jamais modifier une migration déjà appliquée.
- L'arrêt du worker est propre : SIGTERM, le job en cours a 25 s pour finir. Le signal est écouté dès la première ligne du processus : reçu pendant le démarrage, il est gardé et l'arrêt suit la fin du démarrage (OPS-03).

## 3. Revenir en arrière

1. Coolify → Deployments → la version précédente → **Redeploy**. Le code revient ; le schéma reste (expand/contract : l'ancien code le supporte).
2. `/ready`, puis une connexion au dashboard.
3. Si une migration a abîmé des données (rare, et jamais sans un test qui l'aurait vu) : `restore.md` § A (la sauvegarde du jour de Supabase) ou § B (notre export de la nuit).
4. Noter l'incident (`docs/sessions/LOG.md`, section Incidents).

## 4. Sauvegardes

- **Sauvegarde du jour de Supabase** : une par jour, gardée chez Supabase selon son plan ; `restore.md` § A. Le retour à n'importe quel instant (PITR) est une option payante, une décision d'argent de Charles (ADR 0152 § 2).
- **Export quotidien chiffré hors Supabase**, la sauvegarde de référence (ADR 0028, service `backup`) : chaque nuit à 3 h, heure de Paris, un dump complet, relu avant envoi, chiffré pour une clé publique, envoyé chez Hetzner. Chaque export laisse une ligne dans `backup_runs`. Le propriétaire peut aussi demander un export tout de suite (Réglages › Sauvegardes, « Relancer la sauvegarde maintenant ») : l'API inscrit seulement la demande dans `backup_requests`, et le service `backup` la prend dans les 30 secondes pour lancer le même `export.sh` ; rien ne tourne dans l'API ni dans le worker. Restauration et essai trimestriel : `restore.md` § B et § C.
- Les volumes du serveur ne contiennent rien d'irremplaçable : `training` (notes du playground) et la persona montée (dont l'original est hors serveur).

### 4.1 Mettre l'export en service

Une fois, avant toute donnée réelle qu'on ne pourrait pas recréer, et dans tous les cas avant la paie (EQ-17). Une session Remote Control peut faire les étapes 1 et 4 sur le PC ; Charles fait les étapes 2 et 3 dans les consoles.

1. **La paire de clés `age`, sur le PC**, jamais sur le serveur : `age-keygen -o impera-backup.key`. La ligne `# public key: age1…` donne `BACKUP_AGE_RECIPIENT`. Le fichier `impera-backup.key` est la clé privée : deux copies, le gestionnaire de mots de passe et une copie papier, avec à côté `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS` (sans elles, une restauration rend illisibles les sessions et les clés stockées). Chaque rotation de ces clés (`rotate-secrets.md`) met cette copie à jour.
2. **Le bucket**, Hetzner → Object Storage, région dans l'Union européenne (le VPS n'est pas chez Hetzner, ADR 0152 § 4) : un bucket `impera-backups` avec le **versioning** et le **verrou d'objets** (Object Lock, mode gouvernance, 30 jours), une règle de cycle de vie qui supprime les objets de plus de 30 jours. Les factures sur dix ans ont **leurs propres buckets**, dans un autre projet (§ 4.3), jamais celui-ci.
3. **Deux clés d'accès** : une pour le serveur, qui peut écrire et rien d'autre (ni lister, ni supprimer) ; une en lecture seule pour l'essai trimestriel, gardée avec la clé privée. Dans Coolify, avec la première : `BACKUP_S3_ENDPOINT` (`https://<région>.your-objectstorage.com`), `BACKUP_S3_REGION` (`fsn1`, `nbg1`…), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, et `BACKUP_AGE_RECIPIENT`. `BACKUP_DATABASE_URL` reste vide : le service prend `DATABASE_ADMIN_URL`, dont le rôle a `BYPASSRLS` (§ 1.1), sans quoi `pg_dump` échoue sur les tables en `FORCE ROW LEVEL SECURITY`.
4. **Premier export sans attendre la nuit** : Coolify → `backup` → Terminal, `/app/export.sh`. Il affiche `backup: backups/impera-<date>.tar.age (<taille> bytes, sha256 <empreinte>)` et la ligne de `backup_runs` passe à `succeeded`. Puis jouer tout de suite l'essai de `restore.md` § C.
5. **Vérifier la copie des clés** (§ 4.2).

### 4.2 Vérifier la copie des clés de l'application

La copie de `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS` gardée avec la clé privée doit ouvrir les données (ADR 0028 § 7). À faire après le § 4.1, après chaque rotation (`rotate-secrets.md`) et avec chaque essai trimestriel. Coolify → `api` → Terminal :

```sh
node dist/scripts/ops-check-keys.js
```

Coller les deux valeurs **de la copie gardée** quand la commande les demande (rien ne s'affiche à la frappe ; elle ne lit pas celles du serveur). Elle ouvre en mémoire chaque session de plateforme, chaque clé de service IA et chaque jeton de bot Telegram, sur une connexion que la base garde en lecture seule, sans rien appeler ni rien afficher de déchiffré. Attendu : « La copie des clés ouvre toutes les données chiffrées. » Sinon, elle nomme ce qui ne s'ouvre pas (compte, service, bot) : remettre la copie à jour depuis Coolify, puis relancer.

### 4.3 Les buckets des factures

Avant la première facture réelle (EQ-06 lot 4, ADR 0037). En production, l'API et le worker refusent de démarrer sans les dix réglages `INVOICES_*` : jamais un PDF gardé en mémoire. Charles ouvre le compte OVHcloud et crée le projet Hetzner (aucune commande à taper) ; la session de mise en service fait le reste, sans jamais coller une clé dans un chat.

1. **Hetzner, un projet pour les factures seules** (`impera-factures`) : une clé S3 Hetzner vaut pour tous les buckets de son projet, donc la clé de l'application ne doit pas voir les sauvegardes, ni celle de `backup` les factures. Object Storage, région dans l'Union européenne : un bucket avec le **versioning** et le **verrou d'objets** activés à la création (il ne s'active pas après), verrou par défaut en **mode conformité, 10 ans** (filet pour un objet arrivé sans date), et **aucune règle de cycle de vie**.
2. **OVHcloud, la copie** : Object Storage S3 en France (Gravelines ou Paris), un bucket avec versioning et verrou d'objets, verrou par défaut en mode conformité, 10 ans, sans cycle de vie.
3. **Une clé par hébergeur, pour l'application seule** (API et worker) : lire et écrire des objets, poser leur verrou et le prolonger, et lister le bucket. Lister est nécessaire : sans ce droit, un fournisseur répond « accès refusé » au lieu de « absent » pour une clé vide, et le job lit toujours avant d'écrire. Prolonger aussi : un PDF trouvé sous un verrou plus court que dix ans après son émission est prolongé avant d'être enregistré (le mode conformité refuse de toute façon de raccourcir un verrou). Jamais le droit de supprimer ni de contourner un verrou, là où le fournisseur permet de le retirer (OVHcloud) ; chez Hetzner, le projet séparé et le mode conformité en tiennent lieu.
4. **Coolify**, sur `api` et `worker` (ils partagent leurs variables) : `INVOICES_S3_ENDPOINT` (`https://<région>.your-objectstorage.com`), `INVOICES_S3_REGION` (`fsn1`, `nbg1`…), `INVOICES_S3_BUCKET`, `INVOICES_S3_ACCESS_KEY_ID`, `INVOICES_S3_SECRET_ACCESS_KEY` ; puis `INVOICES_COPY_S3_ENDPOINT` (`https://s3.<région>.io.cloud.ovh.net`), `INVOICES_COPY_S3_REGION` (`gra`, `eu-west-par`…), `INVOICES_COPY_S3_BUCKET`, `INVOICES_COPY_S3_ACCESS_KEY_ID`, `INVOICES_COPY_S3_SECRET_ACCESS_KEY`. Les cinq d'un bucket ensemble, chaque adresse en `https`, et la copie chez un autre hôte que le premier bucket : sinon l'API refuse de démarrer en nommant le réglage.
5. **L'essai, sur chaque bucket**, avec la clé de l'application et un objet de quelques octets **verrouillé un jour**, sous `essais/` (seuls les jobs écrivent sous `invoices/` et `archives/`). Le mode conformité ne pardonne pas : jamais plus d'un jour, jamais plus que quelques octets.

   ```sh
   demain=$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)
   printf 'essai' > essai.txt
   aws s3api put-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" \
     --key essais/verrou.txt --body essai.txt \
     --object-lock-mode COMPLIANCE --object-lock-retain-until-date "$demain"
   # Attendus : chacune des trois commandes suivantes est refusée.
   # 412 : une clé écrite ne l'est plus.
   aws s3api put-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" \
     --key essais/verrou.txt --body essai.txt --if-none-match '*'
   # Refusé : la version est verrouillée (VersionId rendu par le premier put-object).
   aws s3api delete-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" \
     --key essais/verrou.txt --version-id "<VersionId>"
   # Refusé : un verrou ne se raccourcit pas.
   aws s3api put-object-retention --endpoint-url "$ENDPOINT" --bucket "$BUCKET" \
     --key essais/verrou.txt --version-id "<VersionId>" \
     --retention "Mode=COMPLIANCE,RetainUntilDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   ```

   Puis, chez Hetzner : la clé de l'application ne liste pas le bucket des sauvegardes, et la clé de `backup` ne liste pas celui des factures (deux `aws s3api list-objects-v2`, refusés). Le verrou de l'objet d'essai tombe le lendemain ; l'objet reste, quelques octets, sans gêne.
6. **Après la première facture réelle** : `invoice_pdfs` et `invoice_pdf_copies` ont chacune sa ligne, avec la même empreinte, et le téléchargement (`GET /v1/payroll/invoices/<id>/pdf`) rend le PDF. Sinon, le job dit pourquoi dans son journal, et le propriétaire reçoit `invoice_pdf_missing` après environ une heure.

### 4.4 Le bucket des médias

Avant le premier dépôt réel d'une créatrice (CR-06 b, ADR 0055 § 3). Son téléphone envoie chaque fichier **directement** au bucket, par morceaux de 8 Mio, chacun à une adresse que l'API signe pour une heure et pour sa taille exacte. Le fichier brut arrive sous `incoming/` ; le nettoyage (CR-06 b2) en retire les métadonnées, garde le fichier nettoyé, puis efface le brut. Charles crée le projet Hetzner (aucune commande à taper) ; la session de mise en service fait le reste, sans jamais coller une clé dans un chat.

1. **Hetzner, un projet pour les médias** (`impera-medias`) : ni les sauvegardes ni les factures n'y vivent, la clé de l'application ne les voit donc pas. Object Storage, région dans l'Union européenne, un bucket **privé**, sans versioning ni verrou (un fichier effacé doit l'être vraiment, CR-06 c).
2. **Deux règles de cycle de vie.** Sur le préfixe `incoming/`, l'expiration au bout d'**un jour** : tout brut disparaît en 24 h, même si le nettoyage n'a pas eu lieu. Sur **tout le bucket** (sans préfixe), l'abandon des envois par morceaux non terminés au bout d'un jour : ceux de son téléphone sous `incoming/`, et ceux du serveur sous `media/` quand il range un gros fichier nettoyé et s'arrête en chemin (relecture Bilan de #516 ; le serveur abandonne déjà lui-même un envoi qui échoue).

   ```json
   {"Rules": [
     {"ID": "brut-24h", "Status": "Enabled", "Filter": {"Prefix": "incoming/"}, "Expiration": {"Days": 1}},
     {"ID": "envois-inacheves", "Status": "Enabled", "Filter": {"Prefix": ""},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}]}
   ```

3. **CORS** : le navigateur de la créatrice envoie ses morceaux depuis l'adresse du CRM et doit lire l'`ETag` de chaque réponse, sans quoi l'envoi ne peut pas se terminer.

   ```json
   {"CORSRules": [{"AllowedOrigins": ["https://app.<domaine>"], "AllowedMethods": ["PUT"],
     "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600}]}
   ```

4. **Une clé pour l'application** (API et worker) : lire, écrire, lister et supprimer des objets de ce bucket, et rien d'autre.
5. **Coolify**, sur `api` et `worker` : `S3_ENDPOINT` (`https://<région>.your-objectstorage.com`, sans le bucket), `S3_REGION` (`fsn1`, `nbg1`…), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Les cinq ensemble, l'adresse en `https`, sinon l'API refuse de démarrer en nommant le réglage. Le service `web` reçoit `S3_ENDPOINT` comme `MEDIA_ORIGIN` : c'est la seule autre adresse que sa politique de sécurité (`connect-src`) laisse joindre.
6. **La place disque du worker** (ADR 0070 § 4) : le worker écrit chaque fichier reçu dans son dossier temporaire (`/tmp` du conteneur, sur le disque du VPS), brut et nettoyé, et prend 2,5 fois son poids avant de commencer. Garder au moins **30 Go libres** sur le VPS pour qu'une vidéo de 10 Gio passe ; sinon le job revient toutes les 15 minutes, et le fichier est refusé (« n'est pas arrivé à temps ») quand le brut disparaît du bucket, au bout de 24 h. Une conversion (ProRes, MKV en VP9…) occupe tous les cœurs moins un, une à la fois ; un redéploiement pendant une conversion la fait reprendre au début.
7. **L'essai** : la créatrice de recette dépose une photo depuis son téléphone ; le dépôt passe à « Reçu », et un objet existe sous `incoming/<créatrice>/<fichier>` jusqu'au nettoyage. Un dépôt retiré pendant l'envoi n'y laisse rien.

## 5. Coupe-circuit

Couper d'abord, comprendre ensuite (`incident.md`). Depuis le dashboard : Supervision → « Tout arrêter ». Sans dashboard, Coolify → `api` → Terminal :

```sh
node dist/scripts/ops-kill-switch.js --on --scope global --reason "<raison>"
node dist/scripts/ops-kill-switch.js --off --scope global --reason "<raison>"
```

Les autres commandes d'exploitation des runbooks (`pnpm ops:revoke-sessions`, `pnpm ops:reset-second-factor`, `pnpm ops:reencrypt-sessions`, `pnpm ops:reencrypt-credentials`, `pnpm ops:check-keys`, `pnpm db:rebuild-projections`) ont leur équivalent dans l'image : `node dist/scripts/<nom>.js` (`ops-revoke-sessions`, `ops-reset-second-factor`, `ops-reencrypt-sessions`, `ops-reencrypt-credentials`, `ops-check-keys`, `rebuild-projections`), mêmes arguments.

Si Supabase ne répond plus, le limiteur de débit laisse passer les requêtes ordinaires (un `warn` « rate limit store unavailable » par requête dans les journaux de `api`), mais la connexion au dashboard répond 503 `service_unavailable` jusqu'au retour de la base (`security.md`). Ce n'est pas une panne de l'API : regarder `/ready` et la page d'état de Supabase.

Arrêter tout le service, en dernier recours : Coolify → Stop. Les messages reçus pendant l'arrêt sont relus au redémarrage par la réconciliation.

## 6. Répétition locale

Avant une première mise en service, ou pour tester un changement du compose : `docker-compose.prod.yml` (en-tête) donne la commande, contre le Postgres de développement. Le job CI `images` fait la même chose à chaque PR.
