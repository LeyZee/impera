# 0152. Hébergement : un VPS Hostinger avec Coolify, la base chez Supabase, les coffres de stockage chez d'autres fournisseurs

Statut : accepted (Charles, 20/11/2026 12h55, heure de Paris, carte de décision, sur le texte relu par Bilan et Sécurité, e917a681)
Date : 2026-11-20
Remplace : l'ADR 0027 sur le lieu (le VPS Hetzner) et l'ADR 0005 sur la base de production (Neon). Le reste de ces deux ADR ne change pas.
Précise : l'ADR 0028 (sauvegarde chiffrée), l'ADR 0037 (coffres des factures), l'ADR 0087 (trois rôles en base) et l'ADR 0067 (adresse du CRM intégrée à l'extension).
Avenant : 20/11/2026, le projet de production est le projet Supabase déjà créé, pas une organisation à part (§ 9).

## Contexte

Rien n'est déployé. Le CRM tourne seulement sur le PC de Charles, avec Docker, Postgres et `pnpm dev:crm`. Pour ouvrir Impera aux chatteurs et aux créatrices, il faut une adresse en https joignable de partout, allumée en permanence.

Le plan écrit jusqu'ici (ADR 0027, `docs/runbooks/deploy.md`) prévoyait un VPS Hetzner avec Coolify, et la base chez Neon. Il n'a jamais été joué. Le 20/11, Charles a tranché autrement :

- le serveur sera un **VPS Hostinger** ;
- la base sera chez **Supabase**, qu'il paie déjà (carte de décision du 20/11). Les deux autres choix proposés étaient Postgres sur le VPS, ou Neon comme prévu.

Il paie aussi Vercel. Cette ADR dit à quoi chaque service sert ici, et à quoi il ne sert pas.

Ce qui tourne ne change pas (ADR 0027) : `migrate` (une fois, puis il s'arrête), `api`, `worker` (Graphile Worker, avec ffmpeg pour les vidéos lourdes, ADR 0070), `web` (nginx, la seule entrée publique, qui renvoie `/v1/` vers l'API) et `backup` (l'export chiffré de la nuit, ADR 0028).

## Décision

### 1. Le serveur : un VPS Hostinger KVM 2, administré par Coolify

- **Taille : KVM 2** (2 vCPU, 8 Go de mémoire, 100 Go NVMe). Coolify, l'API, le worker, nginx et le service de sauvegarde tiennent dans 3 à 4 Go, ce qui laisse de la marge pour ffmpeg. Le KVM 1 (4 Go) serait trop juste. Le KVM 4 ne serait utile qu'avec la base sur le VPS, ce que Charles n'a pas choisi.
- **Lieu** : un centre de données dans l'Union européenne, le plus proche possible de la région de la base (§ 2).
- **Système** : Ubuntu LTS, avec Coolify installé depuis le catalogue Hostinger ou par son script officiel.
- **Le worker a une limite de CPU** dans `docker-compose.prod.yml`, pour qu'un ffmpeg lancé sur 2 vCPU ne ralentisse pas l'API. La valeur est fixée par la fiche de déploiement et vérifiée en conditions réelles.
- Le reste de l'ADR 0027 tient tel quel : deux images, le compose, le limiteur dans Postgres, `TRUST_PROXY_HOPS` à 2 derrière le proxy de Coolify et le nginx de `web`, vérifié sur le vrai serveur.

### 2. La base : Supabase, seulement comme Postgres géré

- **Région dans l'Union européenne** (Paris ou Francfort). **Charles est le seul membre** du compte, avec la double authentification.
- **On n'utilise que Postgres.** La Data API, GraphQL, Auth, Storage et Realtime sont coupés. Les clés `anon` et `service_role` ne servent nulle part. L'authentification reste Better Auth (ADR 0046), le stockage reste celui du § 4.
- **Les rôles prédéfinis de Supabase n'ont aucun droit sur nos données.** `anon`, `authenticated` et `service_role` perdent par `REVOKE` leurs droits sur chaque schéma que nous créons : `public`, celui de la file de jobs (`graphile_worker`) et tout autre à venir. Les privilèges par défaut des futures tables sont révoqués pour chaque rôle qui crée des tables (`postgres` et `nirvana_admin`). Un test vérifie qu'ils n'ont aucun droit sur ces schémas.
- **L'application ne se connecte jamais avec le rôle `postgres` de Supabase.** Il sert une seule fois, à créer nos trois rôles, puis son mot de passe reste chez Charles. L'API, le worker, les migrations et la sauvegarde n'utilisent que les rôles de l'ADR 0087.
- **Aucun outil n'a accès à la production.** Ni jeton d'accès personnel, ni clé d'API, ni connecteur d'assistant (MCP) ne doit voir le projet Supabase de production, le compte Hostinger ou l'API de Coolify. Le projet de production est celui qui a servi aux essais (avenant, § 9) : Charles retire l'accès de tout outil à son compte Supabase avant que la première donnée réelle n'entre. L'identifiant du projet, qui apparaît aussi dans le nom d'utilisateur du pooler, reste hors du dépôt comme les autres valeurs.
- **Nos trois rôles restent ceux de l'ADR 0087**, et aucun n'est superutilisateur : `nirvana_admin` (propriétaire, `BYPASSRLS`, il ne sert qu'aux migrations, à la sauvegarde et aux scripts `ops:*`), `impera_service` (`BYPASSRLS`, ne possède rien) et `nirvana_app` (`NOBYPASSRLS`). Première vérification sur le projet neuf, avant toute migration : le rôle `postgres` de Supabase doit pouvoir créer un rôle `BYPASSRLS` (`select rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user`). Ensuite, chacun de nos trois rôles se connecte par le pooler, et la même requête confirme ses attributs. Si ce n'est pas le cas, **on s'arrête et on revient à cette ADR** : sans `BYPASSRLS` chez le propriétaire, les jobs multi-tenant et certaines vues se vident sans erreur.
- **Un plan payant.** Un projet gratuit se met en pause quand il est inactif, et sa base est plafonnée à 500 Mo. Le projet d'Impera est donc sur le plan payant de Charles.
- **La connexion passe par le pooler de Supabase en mode session**, jamais en mode transaction. Graphile Worker a besoin de `LISTEN/NOTIFY`, et seul le mode session le garde. La connexion directe de Supabase n'existe qu'en IPv6, ce que Docker sous Coolify ne gère pas sans réglage. Les identifiants prennent la forme qu'impose le pooler (le rôle suivi de la référence du projet).
- **Le budget de connexions est fixé et tenu.** En mode session, chaque connexion d'un client garde une connexion du pool de Supabase, et la taille de ce pool est plafonnée selon la taille de calcul du projet. La somme de nos pools reste sous ce plafond, mesuré sur le projet : pools de l'API (applicatif et service), pools du worker, connexions de Graphile Worker (`WORKER_CONCURRENCY`), et celles de `migrate` et de `backup`. La taille de chaque pool, aujourd'hui fixée à 10 dans `packages/db`, devient réglable par une variable validée par Zod, et le budget est écrit dans le runbook. Si la somme ne tient pas, il faut monter la taille de calcul : c'est une décision d'argent, qui revient à Charles.
- **La connexion est en TLS vérifié**, et elle n'est acceptée que depuis l'adresse du serveur, grâce aux restrictions réseau de Supabase. Ces restrictions valent aussi pour le pooler.
- **Version de Postgres.** Le développement, la CI et Testcontainers tournent en 16. Si Supabase propose encore la 16 pour un projet neuf, on la prend. Sinon, une fiche aligne le développement et la CI sur la version de production **avant** la mise en service, et l'image `backup` suit la même version majeure (ADR 0028 § 1).
- **Ce qu'on perd par rapport à Neon, dit en clair.** Neon avait été choisi pour la restauration à n'importe quel instant (PITR) sur 7 jours. Chez Supabase, cette restauration est une option payante. Sans elle, on a une sauvegarde par jour, gardée chez Supabase. **La sauvegarde de référence reste notre export chiffré de la nuit** (ADR 0028), qui ne dépend pas de Supabase. Prendre l'option PITR plus tard est une décision d'argent qui revient à Charles.

### 3. Vercel ne sert pas à Impera

Le site et l'API partagent une même origine à travers le nginx de `web` (ADR 0027 § 3). C'est ce qui garde le cookie de session first-party. Mettre le site chez Vercel séparerait les deux et ferait revenir le problème que l'ADR 0027 a écarté. Vercel n'entre donc pas dans l'hébergement d'Impera. Garder ou résilier l'abonnement est un choix de Charles, que cette ADR ne fait pas.

### 4. Le stockage objet reste hors du serveur et hors de Supabase

Hostinger ne propose pas de stockage objet compatible S3. L'ADR 0028 demande que la sauvegarde soit chez un autre fournisseur que la base, et l'ADR 0037 demande deux fournisseurs distincts pour les factures.

- **Sauvegardes de la nuit** : un bucket chez Hetzner Object Storage (Union européenne), comme le dit l'ADR 0028. On n'a pas besoin d'un serveur Hetzner pour l'utiliser. Le verrou de 30 jours, le versioning, les identifiants qui écrivent sans pouvoir effacer et la clé publique `age` seule sur le serveur ne changent pas.
- **Factures, coffre principal** : chez Hetzner Object Storage, dans un projet séparé, en mode conformité pour dix ans, comme le dit l'ADR 0037 § 4. Les variables `INVOICES_*` restent **obligatoires en production**. On crée les coffres avant la mise en service, plutôt que d'enlever une garde.
- **Factures, seconde copie** : rien ne change par rapport à l'ADR 0037 § 6. Changer un jour de fournisseur ne demanderait qu'un réglage, puisque la configuration vérifie déjà que les deux coffres ne sont pas chez le même.
- **Médias** (`S3_*`) : un bucket privé dans l'Union européenne, chez Hetzner Object Storage, dans son propre projet, avec le versioning et des liens signés de courte durée. Les clés des médias ne voient ni les sauvegardes, ni les factures.

### 5. Le serveur est fermé par défaut

- **SSH** : connexion par clé seulement, pas de connexion root directe, un compte nommé avec `sudo`, et un blocage des essais répétés. Si Charles a une adresse IP fixe, le port SSH n'est ouvert qu'à elle.
- **Pare-feu** : celui de Hostinger fait foi, parce que Docker publie ses ports en passant sous le pare-feu du système. Il n'ouvre que SSH, 80 et 443. Aucun conteneur ne publie de port hors du proxy de Coolify : `web` écoute sur la boucle locale (ADR 0027).
- **Tableau de bord de Coolify** : jamais ouvert au public. On y accède par un tunnel SSH, avec un mot de passe fort et la double authentification. Ses ports d'administration et de temps réel restent fermés. Coolify tient le socket Docker : son compte vaut root.
- **Compte Hostinger, registraire et DNS** : la double authentification est obligatoire sur chacun, car ils valent root eux aussi (console, réinstallation, instantanés).
- **Mises à jour** : les correctifs de sécurité du système s'installent seuls, avec un redémarrage planifié. Charles met Coolify à jour lui-même, sur un rappel.
- **Instantanés Hostinger et sauvegarde propre à Coolify** : ils contiennent des secrets. Soit ils sont coupés, soit ils sont chiffrés avec la clé publique de sauvegarde.
- **Journal d'accès du proxy** : il ne garde ni les chemins, ni les paramètres (deploy.md § 1.2), et il est gardé 30 jours au plus. Aucune donnée de fan n'entre dans un journal.
- **HTTPS** : HSTS, TLS 1.2 au minimum et un enregistrement CAA sur le domaine. Si l'application envoie un jour des e-mails : SPF, DKIM et DMARC.

### 6. Déploiement : seulement depuis `main`, aucun secret dans le dépôt ni dans l'image

- Coolify déploie `docker-compose.prod.yml` depuis `main` seulement, avec une clé de lecture limitée à ce dépôt. Il n'y a aucun webhook public vers Coolify, puisque son tableau de bord est fermé : soit Charles déclenche le déploiement à la main, soit Coolify interroge le dépôt. **Aucun déploiement d'aperçu pour les PR** : le dépôt est public, et une PR d'un inconnu construite sur le serveur verrait les secrets du build.
- Aucun secret en argument de build, car il resterait dans l'historique de l'image. Seules des valeurs publiques y passent, comme l'adresse du site intégrée à l'extension (ADR 0067).
- **Les secrets sont générés sur le PC de Charles**, différents de ceux du développement. Il les saisit lui-même dans Coolify, marqués comme secrets. Le serveur ne détient que la clé **publique** de sauvegarde. La clé privée `age`, `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS` sont gardées hors du serveur (ADR 0028 § 7), et la clé privée ne quitte jamais son PC. La rotation suit `docs/runbooks/rotate-secrets.md`.
- **Le domaine définitif est choisi avant la mise en service.** Il fixe les clés d'accès et l'adresse intégrée à l'extension : le changer ensuite les rend inutilisables. Ni le domaine, ni l'adresse IP, ni un nom d'hôte, ni un nom de compte n'entrent dans le dépôt, la mémoire ou le chat : ils restent chez Charles.
- **Il n'y a pas de pré-production avec des données réelles.**

### 7. Surveillance et incident

- Un service extérieur au serveur interroge `/health` et `/ready`, et prévient Charles quand ils ne répondent plus. On surveille aussi le disque et les connexions SSH refusées.
- La marche à suivre en cas d'incident (`docs/runbooks/incident.md`) dit : couper les sessions, faire tourner les clés, prévenir.
- **Avant l'ouverture**, une restauration de l'export chiffré est jouée de bout en bout (ADR 0028), et la liste des sous-traitants est tenue à jour : hébergeur, base, stockage, fournisseurs d'IA.

### 8. Ce que l'hébergement change pour la session Reveal, sans le décider

La session Reveal du compte bot dure 24 heures depuis la connexion, et son renouvellement n'est pas tranché. Un serveur allumé en permanence ne la garde pas en vie : si personne ne refait une Sync depuis l'extension, l'agent s'arrête au bout de 24 heures, que le PC de Charles soit allumé ou non. La seule différence est que la Sync envoie désormais la session au serveur hébergé au lieu du PC. Une connexion automatique avec les identifiants du bot reste interdite sans l'accord écrit de Charles et une ADR à elle. Cette ADR ne tranche rien sur ce point.

### 9. Avenant du 20/11/2026 : la production sur le projet des essais

Le 20/11 au soir, Charles a écrit qu'il garde pour la production le projet Supabase qu'il a créé pour Impera, et qui a servi aux essais. Il ne veut pas d'organisation à part. Le projet sera vidé des essais à la mise en ligne. Ce projet est dans l'Union européenne, en Postgres 17 (fiche OPS-20). Il doit être sur un plan payant (§ 2), ce que Charles vérifie avant la mise en ligne.

L'organisation à part avait un seul but : qu'aucun outil branché pendant le développement ne garde la main sur les données réelles. Les garde-fous suivants tiennent ce but autrement, et le runbook (`deploy.md` § 1.1) les fait jouer dans cet ordre :

- **Avant de repartir d'une base vide, et donc avant la première donnée réelle, plus aucun outil n'a accès au compte Supabase.** C'est la fin des essais : tout ce qui suit se joue par Charles seul, et les essais qui doivent encore toucher ce projet (pooler, Postgres 17) sont finis avant. Charles retire l'autorisation de tout connecteur d'assistant (MCP) et de toute intégration, et supprime tout jeton d'accès personnel. Il reste le seul membre de l'organisation, avec la double authentification. Il ne suffit pas de passer un connecteur en lecture seule : la lecture d'une base de fans est déjà une fuite. Un connecteur s'autorise pour toute une organisation : il ne se rebranche donc plus jamais sur celle-ci.
- **Les clés vues pendant les essais sont régénérées** (clés d'API du projet, secret JWT), l'API de données et Realtime sont coupés, et les branches, fonctions Edge, secrets et notebooks des essais sont supprimés. Charles lit le journal d'audit de l'organisation avant la mise en ligne.
- **Les restrictions réseau ne laissent passer que l'adresse du serveur**, en IPv4 et en IPv6, sur la connexion directe comme sur le pooler, et SSL est imposé. Une valeur vue pendant les essais (hôte, nom d'utilisateur du pooler) ne sert plus à rien depuis ailleurs. L'adresse du PC de Charles n'y entre que le temps d'une mise en service ou d'une restauration.
- **On repart d'une base vide.** Le runbook liste ce qui reste des essais (nos rôles, nos schémas, nos tables, et toute extension, fonction, déclencheur ou publication qui ne vient ni de Supabase ni de nos migrations). Sur le mot écrit de Charles, comme toute suppression en base, tout ce que possèdent nos rôles est effacé en bloc, puis nos rôles eux-mêmes ; ce qu'un essai aurait créé en `postgres` est listé et supprimé sur le même mot, sans toucher aux schémas de Supabase. Ils sont recréés avec des mots de passe jamais utilisés pendant les essais, les migrations repartent de zéro, et le mot de passe de `postgres` change après la mise en service, comme prévu au § 2.
- **Après la mise en ligne, plus aucun essai sur ce projet.** Le développement et les tests tournent sur le Postgres local (`docker compose`) et sur Testcontainers, comme aujourd'hui. Un essai qui a besoin de Supabase lui-même (le pooler, une mise à jour de Supabase) se fait sur un projet temporaire que Charles crée, puis supprime.
- **Les essais du pooler** (`migrate`, `LISTEN/NOTIFY` de la file de jobs, budget de connexions) se jouent sur ce projet **avant** la mise en ligne, depuis le PC de Charles ou depuis le serveur.

Ce que l'avenant coûte, dit en clair : les essais et la production partagent un historique (journaux de Supabase, sauvegardes du jour prises pendant les essais). Ces traces ne contiennent aucune donnée réelle, puisque les essais n'en utilisent jamais. La rétention des sauvegardes de Supabase est notée avant la première donnée réelle. Le risque qui reste est celui du compte Supabase de Charles : sa double authentification est obligatoire. Ces points entrent dans l'audit de sécurité d'avant ouverture, vérifiés par des requêtes de lecture que Charles lance lui-même.

## Conséquences

- Coût mensuel hors IA : environ 8 € pour le VPS (prix promotionnel sur 24 mois, puis environ 15 €), Supabase déjà payé, et quelques euros pour les buckets.
- Risque accepté : les rôles de lecture de l'hébergeur (membres de `pg_read_all_data`, par exemple le rôle en lecture seule du tableau de bord Supabase) lisent toutes nos tables. C'est le prix d'une base gérée ; le démarrage les nomme dans les journaux sans refuser, et aucun connecteur n'a accès au compte Supabase une fois les données réelles entrées (§ 9).
- `docs/runbooks/deploy.md` et `docs/architecture/operations.md` sont réécrits pour Hostinger et Supabase dans la fiche de déploiement. Les étapes Neon disparaissent, les vérifications de rôles restent.
- Un test d'intégration prouve que les rôles `anon`, `authenticated` et `service_role` n'ont aucun droit sur `public`.
- Deux sous-traitants de plus dans le registre : Hostinger (société de l'Union européenne) et Supabase (société américaine, hébergée chez AWS, région dans l'Union européenne, avec un accord de sous-traitance à signer). Les messages des fans touchent à la vie sexuelle de personnes identifiables, une catégorie de données que le RGPD traite comme sensible. Seuls les secrets scellés sont chiffrés par l'application ; les messages ne le sont pas, et les deux prestataires ont un accès technique au disque.
- Un seul serveur, sans redondance : une panne de Hostinger arrête Impera jusqu'à son retour. La base et les sauvegardes, elles, sont ailleurs.

## Alternatives rejetées

- **Postgres sur le VPS** : une seule facture, la base la plus proche, tout dans l'Union européenne, mais les sauvegardes, les correctifs et les pannes de la base seraient à notre charge, et il faudrait le KVM 4. Charles a choisi Supabase.
- **Neon, comme prévu** : le plan écrit marchait tel quel, avec la restauration à l'instant, mais c'était un abonnement de plus alors que Supabase est déjà payé.
- **Le site chez Vercel** : voir § 3.
- **Supabase Storage pour les médias, les sauvegardes ou les factures** : la sauvegarde serait chez le même fournisseur que la base (contraire à l'ADR 0028 § 4), et il n'y a pas de verrou en mode conformité pour les factures.
- **Rendre `INVOICES_*` facultatives tant que la paie est éteinte** : c'est une garde de moins et un avenant à l'ADR 0037, pour économiser quelques euros par mois.
