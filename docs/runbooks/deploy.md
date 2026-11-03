# Déploiement en production

Mettre Impera en service sur le VPS (Hetzner, Coolify), le mettre à jour, revenir en arrière. Décisions : ADR 0027 (images, compose, limiteur) et ADR 0005 (Neon). Tout ce qui suit se fait dans Coolify, Neon et un terminal sur le serveur ; rien ne passe par un fichier du dépôt.

**Pas encore joué** : les étapes Neon et Coolify suivent leur documentation et la répétition locale (§ 6), pas une vraie mise en service. La première mise en service les vérifie ; tout écart se corrige ici, dans la même journée.

Rien n'envoie à un fan tant que `connector_config.writes` n'est pas ouvert pour son compte (ADR 0018) : une mise en service ne parle à personne.

## Ce qui tourne

| Service | Image | Rôle |
|---|---|---|
| `migrate` | `apps/api/Dockerfile` | applique les migrations, puis s'arrête ; rien d'autre ne démarre s'il échoue |
| `api` | même image | l'API, `/health` et `/ready` |
| `worker` | même image, `node dist/worker.js` | les jobs (Graphile Worker), jamais de HTTP |
| `web` | `apps/web/Dockerfile` | le dashboard, et `/v1/` renvoyé vers l'API : **seul service public** |
| `backup` | `ops/db-export/Dockerfile` | l'export quotidien chiffré hors Neon, chaque nuit à 3 h (ADR 0028, § 4) |

Le tout est décrit par `docker-compose.prod.yml`. L'API n'a pas de domaine : le navigateur l'atteint par `https://<domaine>/v1/`, à travers le nginx de `web`.

**Réseau sortant de l'API et du worker : les buckets des factures.** Le worker envoie chaque PDF chez Hetzner puis chez OVHcloud, et l'API les relit pour un téléchargement (ADR 0037 ; § 4.3 ci-dessous). Si un hôte est coupé, le job réessaie environ une heure puis alerte le propriétaire ; le téléchargement lit l'autre copie.

**Réseau sortant du worker : la BCE.** Le job `payroll.fetch_exchange_rates` lit chaque heure, à la 7ᵉ minute, les taux de référence de la BCE sur `https://www.ecb.europa.eu` (ADR 0033). La requête part en HTTPS, sans clé, et n'envoie aucune donnée de l'agence. Si un pare-feu coupe cet hôte, le job échoue à chaque passage et n'écrit rien. Les brouillons gardent le dernier taux connu. Une clôture est refusée (`exchange_rate_missing_conflict`) dès que le dernier taux date de plus de quatre jours avant la fin de la quinzaine. Rien n'est payé sur un taux deviné. Quand l'hôte revient, le passage suivant rattrape les jours manqués, sur 90 jours au plus.

**Réseau sortant de l'API : Pwned Passwords.** Quand un mot de passe est choisi (lien d'invitation ou de nouveau mot de passe, `pnpm owner:create`), l'API demande à `https://api.pwnedpasswords.com` s'il circule dans des fuites connues (ADR 0046 § 4). Seuls les 5 premiers caractères de son empreinte SHA-1 sortent, jamais le mot de passe ni l'e-mail. Si un pare-feu coupe cet hôte, aucun mot de passe ne peut être choisi (503, l'écran dit de réessayer) : l'autoriser avant d'inviter l'équipe.

## 1. Première mise en service

### 1.1 Base Neon

1. Neon → nouveau projet, région Europe (Francfort), Postgres 16. PITR : 7 jours au moins. « Scale to zero » **désactivé** (le worker écoute la base en continu).
2. Le rôle propriétaire créé par Neon sert de rôle admin (`nirvana_admin` dans la doc). Noter sa chaîne de connexion **directe** (sans `-pooler` dans l'hôte) : c'est `DATABASE_ADMIN_URL`.
3. Créer le rôle applicatif, sans contournement de RLS, dans l'éditeur SQL de Neon, connecté avec le rôle admin. Mot de passe : `openssl rand -base64 24`, jamais réutilisé.

   ```sql
   CREATE ROLE nirvana_app LOGIN PASSWORD '<mot de passe>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   GRANT CONNECT ON DATABASE neondb TO nirvana_app;
   GRANT USAGE ON SCHEMA public TO nirvana_app;
   ```

   (Remplacer `neondb` par le nom de la base.) Les migrations donnent ensuite à `nirvana_app` ses droits table par table.
4. Vérifier les attributs des deux rôles, dans le même éditeur, toujours connecté avec le rôle admin :

   ```sql
   SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN (current_user, 'nirvana_app');
   ```

   Attendu : le rôle admin à `rolbypassrls = t`, `nirvana_app` à `f`, et `rolsuper = f` pour les deux. Les migrations posent `FORCE ROW LEVEL SECURITY`, qui s'applique aussi au propriétaire des tables : sans `BYPASSRLS`, le déploiement passe, mais chaque job multi-tenant et chaque lecture `withAdmin` ne voient plus aucune ligne, sans erreur. L'attribut ne s'hérite pas de `neon_superuser`. Le serveur et le worker refusent d'ailleurs de démarrer dans ce cas (et si `nirvana_app` contourne la RLS), avec un message qui renvoie ici. Si le rôle admin est à `f`, **on s'arrête et on demande** : c'est une question d'ADR (0005), pas un réglage à contourner.
5. `DATABASE_URL` = la même chaîne directe, avec `nirvana_app` et son mot de passe, et `?sslmode=require`.

Le pooler de Neon (hôte en `-pooler`) est interdit : Graphile Worker a besoin de `LISTEN/NOTIFY`.

### 1.2 Coolify

1. Coolify → Projet « Impera » → Ressource → **Docker Compose**, depuis le dépôt GitHub `LeyZee/impera`, branche `main`, fichier `docker-compose.prod.yml`.
2. Domaine : sur le service **`web` seulement**, port 8080 (ex. `https://app.<domaine>`). Aucun domaine sur `api`, `worker`, `migrate`.
3. Cocher « Include Source Commit in Build » : `SOURCE_COMMIT` devient le tag de l'image et `RELEASE` (Sentry, battement du worker).
4. Déploiement automatique sur push de `main` : oui. `main` ne change que par une PR verte.
5. **Journal d'accès du proxy.** Le jeton d'un lien de calendrier est dans le chemin (`/v1/calendar-feed/<jeton>.ics`), et quiconque lit ce chemin lit les shifts de son titulaire. L'API ne le journalise pas, et le `nginx` de `web` non plus ; le Traefik de Coolify ne doit pas le garder non plus.
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
| `DATABASE_URL`, `DATABASE_ADMIN_URL` | § 1.1 |
| `SESSION_ENCRYPTION_KEYS` | `v1:` + `openssl rand -base64 32` |
| `CREDENTIALS_ENCRYPTION_KEYS` | `v1:` + une **autre** sortie de `openssl rand -base64 32` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_BASE_URL`, `WEB_ORIGIN` | l'URL publique du dashboard, la même pour les deux (`https://app.<domaine>`). Son domaine est celui des clés d'accès (ADR 0053) : le changer rend toutes les clés inutilisables ; chacun se reconnecte avec son mot de passe et son code, puis ajoute une nouvelle clé |
| `EXTENSION_DEVICE_TOKEN` | `openssl rand -hex 24` (48 caractères) |
| `TRUST_PROXY_HOPS` | `2` (le proxy de Coolify, puis le nginx de `web`) ; défaut du compose |
| `PLAYGROUND_PERSONA_PATH` | facultatif : chemin **dans le conteneur** de la persona du playground (§ 1.5) ; démo sans lui. Les brouillons, les gardes et « À apprendre » ne le lisent pas |
| `BACKUP_*` | § 4.1 ; sans elles, l'export de la nuit échoue et l'alerte le signale |
| `SENTRY_DSN`, `LANGFUSE_*`, `S3_*`, `VAPID_*` | facultatifs, vides tant que le service n'existe pas |

Les clés des services IA (xAI, Google, Mistral, ElevenLabs) ne sont **pas** des variables en production : elles se collent dans Réglages › Modèles IA › Services (ADR 0016). Les deux clés de chiffrement se gardent aussi hors du serveur (gestionnaire de mots de passe) : les perdre rend illisibles les sessions et les clés stockées.

### 1.4 Premier déploiement

1. Coolify → Deploy. Ordre attendu dans les journaux : `migrate` « Migrations applied. » et sort avec 0, puis `api` et `worker`, puis `web`.
2. Vérifier :
   - `https://app.<domaine>/` affiche l'écran de connexion ;
   - Coolify → `api` → Terminal : `wget -qO- http://127.0.0.1:3000/ready` → `"status":"ready"` avec `database`, `migrations` et `worker` à `true`.
3. Créer le compte propriétaire (pas d'inscription publique), Coolify → `api` → Terminal :

   ```sh
   node dist/scripts/create-owner.js --email <e-mail> --name <nom>
   ```

   Le mot de passe se tape deux fois, sans écho (12 caractères au moins).
4. Se connecter au dashboard, créer la créatrice dans Créatrices (ou `node dist/scripts/create-creator.js --name <nom>`).

### 1.5 Persona réelle

La persona réelle ne vit jamais dans le dépôt (ADR 0010). L'agent écrit avec la version **active** de la persona de la créatrice, en base : ses brouillons, ses relances, les gardes rejouées à l'approbation et « À apprendre » la lisent à chaque appel. Sans version active, l'agent n'écrit rien (passage à un chatteur, cause « Pas de persona active ») et **aucun message ne peut être approuvé** pour elle. Activer une version dans Créatrices › Persona, ou depuis un fichier monté : Coolify → service `api` → Storages → montage de fichier : chemin `/data/persona/persona.yaml`, contenu = le YAML, puis, pour l'enregistrer comme version de la créatrice et l'activer :

```sh
node dist/scripts/persona-validate.js /data/persona/persona.yaml
node dist/scripts/persona-load.js /data/persona/persona.yaml --activate
```

## 2. Mettre à jour

Une PR fusionnée dans `main` déclenche le déploiement. Rien à faire à la main, sauf vérifier : Coolify → Deployments → dernier statut, puis `/ready`.

- Les migrations passent avant le nouveau code (`migrate`), en expand/contract (`operations.md`) : l'ancien code tourne encore sur le nouveau schéma pendant la bascule.
- Un `migrate` en échec arrête le déploiement : l'ancienne version reste en ligne. Lire son journal, corriger par une nouvelle PR. Ne jamais modifier une migration déjà appliquée.
- L'arrêt du worker est propre : SIGTERM, le job en cours a 25 s pour finir. Le signal est écouté dès la première ligne du processus : reçu pendant le démarrage, il est gardé et l'arrêt suit la fin du démarrage (OPS-03).

## 3. Revenir en arrière

1. Coolify → Deployments → la version précédente → **Redeploy**. Le code revient ; le schéma reste (expand/contract : l'ancien code le supporte).
2. `/ready`, puis une connexion au dashboard.
3. Si une migration a abîmé des données (rare, et jamais sans un test qui l'aurait vu) : `restore.md` § A (retour à un instant T avec Neon).
4. Noter l'incident (`docs/sessions/LOG.md`, section Incidents).

## 4. Sauvegardes

- **PITR Neon** (§ 1.1) : retour à n'importe quel instant des 7 derniers jours ; procédure dans `restore.md` § A.
- **Export quotidien chiffré hors Neon** (ADR 0028, service `backup`) : chaque nuit à 3 h, heure de Paris, un dump complet, relu avant envoi, chiffré pour une clé publique, envoyé chez Hetzner. Chaque export laisse une ligne dans `backup_runs`. Le propriétaire peut aussi demander un export tout de suite (Réglages › Sauvegardes, « Relancer la sauvegarde maintenant ») : l'API inscrit seulement la demande dans `backup_requests`, et le service `backup` la prend dans les 30 secondes pour lancer le même `export.sh` ; rien ne tourne dans l'API ni dans le worker. Restauration et essai trimestriel : `restore.md` § B et § C.
- Les volumes du serveur ne contiennent rien d'irremplaçable : `training` (notes du playground) et la persona montée (dont l'original est hors serveur).

### 4.1 Mettre l'export en service

Une fois, avant toute donnée réelle qu'on ne pourrait pas recréer, et dans tous les cas avant la paie (EQ-17). Une session Remote Control peut faire les étapes 1 et 4 sur le PC ; Charles fait les étapes 2 et 3 dans les consoles.

1. **La paire de clés `age`, sur le PC**, jamais sur le serveur : `age-keygen -o impera-backup.key`. La ligne `# public key: age1…` donne `BACKUP_AGE_RECIPIENT`. Le fichier `impera-backup.key` est la clé privée : deux copies, le gestionnaire de mots de passe et une copie papier, avec à côté `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS` (sans elles, une restauration rend illisibles les sessions et les clés stockées). Chaque rotation de ces clés (`rotate-secrets.md`) met cette copie à jour.
2. **Le bucket**, Hetzner → Object Storage, même région que le VPS : un bucket `impera-backups` avec le **versioning** et le **verrou d'objets** (Object Lock, mode gouvernance, 30 jours), une règle de cycle de vie qui supprime les objets de plus de 30 jours. Les factures sur dix ans ont **leurs propres buckets**, dans un autre projet (§ 4.3), jamais celui-ci.
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

1. **Hetzner, un projet pour les factures seules** (`impera-factures`) : une clé S3 Hetzner vaut pour tous les buckets de son projet, donc la clé de l'application ne doit pas voir les sauvegardes, ni celle de `backup` les factures. Object Storage, même région que le VPS : un bucket avec le **versioning** et le **verrou d'objets** activés à la création (il ne s'active pas après), verrou par défaut en **mode conformité, 10 ans** (filet pour un objet arrivé sans date), et **aucune règle de cycle de vie**.
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

## 5. Coupe-circuit

Couper d'abord, comprendre ensuite (`incident.md`). Depuis le dashboard : Supervision → « Tout arrêter ». Sans dashboard, Coolify → `api` → Terminal :

```sh
node dist/scripts/ops-kill-switch.js --on --scope global --reason "<raison>"
node dist/scripts/ops-kill-switch.js --off --scope global --reason "<raison>"
```

Les autres commandes d'exploitation des runbooks (`pnpm ops:revoke-sessions`, `pnpm ops:reset-second-factor`, `pnpm ops:reencrypt-sessions`, `pnpm ops:reencrypt-credentials`, `pnpm ops:check-keys`, `pnpm db:rebuild-projections`) ont leur équivalent dans l'image : `node dist/scripts/<nom>.js` (`ops-revoke-sessions`, `ops-reset-second-factor`, `ops-reencrypt-sessions`, `ops-reencrypt-credentials`, `ops-check-keys`, `rebuild-projections`), mêmes arguments.

Si Neon ne répond plus, le limiteur de débit laisse passer les requêtes ordinaires (un `warn` « rate limit store unavailable » par requête dans les journaux de `api`), mais la connexion au dashboard répond 503 `service_unavailable` jusqu'au retour de la base (`security.md`). Ce n'est pas une panne de l'API : regarder `/ready` et Neon.

Arrêter tout le service, en dernier recours : Coolify → Stop. Les messages reçus pendant l'arrêt sont relus au redémarrage par la réconciliation.

## 6. Répétition locale

Avant une première mise en service, ou pour tester un changement du compose : `docker-compose.prod.yml` (en-tête) donne la commande, contre le Postgres de développement. Le job CI `images` fait la même chose à chaque PR.
