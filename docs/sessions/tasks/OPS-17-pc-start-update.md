# OPS-17 Démarrer Impera : le PC se met à jour seul au démarrage
Statut : review
Phase : exploitation
Dépend de : ADR 0125 (accepted le 16/11/2026), ADR 0028, ADR 0029
Branche : task/ops-17-pc-start-update

## Objectif (1 phrase)

Un correctif fusionné sur `main` atteint le CRM du PC de Charles à son prochain démarrage, sans session distante ni geste de sa part, la base sauvegardée avant toute migration.

## Contexte à lire (fichiers précis)

- `docs/adr/0125-pc-updates-itself-at-start.md` (§ 1 à § 5 et § 7 ; le § 6 est au fil Extension).
- `docker-compose.yml`, `docker-compose.prod.yml`, `apps/api/Dockerfile` (disposition de l'API construite), `apps/web/nginx.conf.template`.
- `apps/api/src/shutdown.ts`, `apps/api/src/readiness.ts` (`/ready`).

## À faire (liste vérifiable)

- [x] `ops/pc/start.mjs` : base démarrée d'abord (`docker compose up -d --wait postgres`, seul programme autorisé à le faire, § 7), une seule fenêtre à la fois, refus si un CRM répond déjà (`pnpm dev:crm`).
- [x] L'ordre du § 2 (`ops/pc/update.mjs`) : dépôt propre et sur `main` exigés, récupération de `main` en avance rapide seulement, sans réseau ou rien de nouveau on démarre, sinon `pnpm install --frozen-lockfile` et `pnpm build`.
- [x] Migrations nouvelles lues dans le journal de Drizzle entre le commit que la base a reçu et le nouveau ; sauvegarde d'abord par la commande de `ops/pc/local/config.json` (validée à la main : la racine n'a pas Zod), migrations arrêtées si elle échoue ; puis `pnpm db:migrate`.
- [x] Migration destructive jamais lancée sans son nom dans `allowDestructiveMigrations` (`ops/pc/migrations.mjs`, règle qui refuse par défaut, durcie après la relecture Sécurité du 16/11, décrite dans `ops/pc/README.md`) ; 2 migrations écrites jusqu'ici auraient été retenues (« drop » de contenu dans un texte). Limite acceptée par Sécurité : si la base est plus ancienne que `migratedCommit` (sauvegarde restaurée), `pnpm db:migrate` rejoue aussi des migrations hors de la liste vérifiée.
- [x] Santé sous 2 minutes : `/ready` de l'API et le site servi.
- [x] Retour arrière du § 4 : commit précédent (`git reset --keep`), reconstruit, redémarré ; la version fautive n'est plus retentée tant que `main` n'a pas bougé ; les migrations ne reculent jamais ; l'ancienne qui échoue aussi laisse le CRM arrêté, en rouge.
- [x] Superviseur (`ops/pc/supervisor.mjs`) : l'API construite (worker dans le processus, comme `.env` le dit) et `vite preview` du site construit, en mode `development` pour garder le relais `/v1` de `apps/web/.env.development` ; relance avec une pause qui double (une minute au plus) ; arrêt propre.
- [x] Arrêt propre sous Windows : l'API s'arrête aussi sur le message `impera:stop` reçu par son canal IPC, le même chemin que SIGTERM (`apps/api/src/shutdown.ts`, test) ; Ctrl+C dans la fenêtre arrête le tout.
- [x] Les fichiers que l'API construite lit à côté de `dist/` (migrations, prompts) copiés après chaque construction, comme dans l'image ; ignorés par git.
- [x] Entrées Windows : `ops/pc/Démarrer Impera.cmd`, `ops/pc/Installer le démarrage automatique.cmd` et `ops/pc/install-task.ps1` (PowerShell 5.1 : tâche planifiée à l'ouverture de session, compte de Charles, droits limités, sans administrateur ; raccourci dans Démarrage si Windows refuse).
- [x] Statut et journal sans valeur dans `ops/pc/local/` : `status.json` (ci-dessous), `journal.log` (commits courts, noms de migrations, étapes, durées, statuts).
- [x] Tests (`pnpm test:scripts`) : décision depuis l'état du dépôt, différence de migrations, refus des destructives, réglages, ordre complet avec faux git/pnpm/sauvegarde/CRM, retour arrière, relance et arrêt du superviseur.
- [ ] § 3 : mise à jour pendant que le CRM tourne, au repos seulement. Reste : il faut une lecture « au repos » (aucune conversation du Playground active depuis 30 min, aucun envoi en cours ou à vérifier, aucun job du connecteur en cours) que l'API n'expose pas aujourd'hui ; elle touche le Playground (en mémoire), les envois et la file de jobs, donc plusieurs modules, plus la route et ses balayages d'authentification et d'origine. D'ici là, une version nouvelle attend le prochain démarrage, ce que le § 3 prévoit quand le CRM n'est pas au repos.
- [ ] § 5 : la ligne dans le CRM. Reste : une route de l'API, propriétaire seul, qui lit `status.json`, et la ligne dans l'écran (`apps/web`, fil Design). Contrat ci-dessous.
- [ ] Alerte Telegram du même texte, quand le bot existera (§ 5).

## Contrat de `ops/pc/local/status.json` (pour la route et l'écran)

Écrit à la fin de chaque démarrage (écriture à côté puis renommage : jamais à moitié) :

```json
{
  "version": 1,
  "outcome": "updated | up_to_date | current | rolled_back | stopped",
  "reason": "updated | up_to_date | offline | dirty | not_main | diverged | known_failed | destructive | no_backup | unreadable_journal | rewritten_journal | merge_failed | build_failed | backup_failed | migrate_failed | unhealthy | database_unavailable",
  "tone": "neutral | amber | red",
  "line": "Mis à jour le 16 novembre 2026 à 08:12",
  "detail": "texte en français ou null",
  "commit": "7 caractères ou null",
  "updatedAt": "ISO 8601 de la dernière mise à jour réussie, ou null",
  "at": "ISO 8601 de ce démarrage"
}
```

`line` vaut « Mis à jour le … » (date de Paris), « Mise à jour échouée, version précédente » (retour arrière, ou version fautive pas retentée), « Version présente » (jamais mis à jour par ce programme) ou « CRM arrêté : … » (rouge). L'écran affiche `line`, et `detail` en dessous quand il n'est pas `null`, avec la couleur de `tone`. La route ne sert que ces champs, au propriétaire seul ; le fichier absent vaut « pas encore de démarrage par Démarrer Impera ».

## Critères d'acceptation (tests, commandes, comportements observables)

- `pnpm check`, `pnpm test` et la CI verts.
- Sur le PC : un démarrage sans rien de nouveau ne reconstruit rien ; un `main` en avance est récupéré, construit, migré après la sauvegarde et démarré ; une sauvegarde qui échoue laisse la version précédente, en ambre.

## Hors périmètre

- § 6 (jeton Reveal) : fil Extension.
- Réparer la sauvegarde du PC (diagnostic à part) ; changer `docker-compose.yml` (la politique de redémarrage de la base est une étape de Charles, dans son `docker-compose.override.yml`).

## Résultat

Le programme, ses entrées Windows et ses tests ; l'API s'arrête proprement sur le message du superviseur. Restent le § 3, la ligne du § 5 dans le CRM et l'alerte Telegram. Ce que Charles fait une fois : `ops/pc/README.md` § « Une fois ».
