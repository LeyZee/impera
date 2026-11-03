# Git et pull requests

## Branches

- `main` : toujours déployable. Elle ne change que par une PR à la CI verte, fusionnée (squash). Jamais de push direct.
  - Le dépôt est privé sur un compte gratuit, donc GitHub n'applique aucune protection de branche. Le garde-fou est local : le hook pre-push `protect-main` (`scripts/protect-main.mjs`, installé par `pnpm install` via lefthook) refuse tout push vers `main` et sa suppression.
  - Il se contourne et ne remplace pas une protection côté serveur. En urgence seulement, et en le disant dans le journal : `IMPERA_ALLOW_MAIN_PUSH=1 git push …`. `--no-verify` reste interdit.
- `task/<id>-<slug>` en minuscules (`task/p0-03-database`) : une branche par fiche de tâche. Supprimée après fusion (squash).
- Pas de branche longue durée. Une fiche qui dure plus d'une semaine est trop grosse : on la découpe.

## Commits

Conventional Commits, en anglais, impératif, scope = module ou package :

```
feat(conversations): ingest messages idempotently by platform_message_id
fix(connectors): retry listConversations on 502 with backoff
chore(cleanup): remove unused fixtures from media tests
docs(adr): propose 0015 config loading
test(agent): cover disgust guard with persona fixtures
refactor(fans): extract fact retention into domain
```

Un commit compile et passe `pnpm check`. Pas de `wip`. Pas de secret, évidemment.

Chaque commit écrit par une session se termine par ses deux lignes d'attribution (`Co-Authored-By:` et `Claude-Session:`, fournies à la session) ; on ne les retire jamais, elles disent qui a écrit quoi.

## Pull requests

- Titre : `<id> <titre de la fiche>` (ex. `P0-03 Bootstrap de l'API et ingestion`).
- Corps : le template `.github/pull_request_template.md`. « Avant » / « Après » en français simple, puis « Comment », puis la checklist. Le corps se termine par la mention « Generated with Claude Code » et le lien de session fournis à la session.
- Petites : < 500 lignes de diff hors tests et fichiers générés. Au-delà, on découpe. Exception : les fiches de bootstrap (P0-01, P0-03) qui créent la structure ; leur revue porte sur la structure et les conventions.
- La session ouvre la PR en brouillon (`gh pr create --draft`) dès que la branche compile, et la passe en « prête » quand `pnpm check` et `pnpm test` sont verts.
- Une PR = une fiche. Pas de « tant que j'y étais ».
- Fusion par squash, message = titre de la PR.

## Sessions en parallèle

- Plusieurs fiches peuvent avancer en même temps, chacune sur sa branche. Charles attribue les fiches ; deux sessions ne prennent jamais la même.
- Avant d'ouvrir ou de mettre à jour une PR : `git fetch origin main && git rebase origin/main`. Pas de commit de fusion.
- Chaque session écrit son journal dans son propre fichier `docs/sessions/log/<date>-<id>.md` (voir `docs/sessions/README.md`) ; `docs/sessions/LOG.md` n'est qu'un index. Un fichier par session, zéro conflit.

## Revue

Ce que le relecteur regarde, dans l'ordre : (1) frontières et contrats respectés, (2) tests présents et pertinents, (3) sécurité (checklist de `security.md`), (4) hygiène (rien de parasite), (5) docs à jour, (6) lisibilité. Le style est l'affaire de Prettier et ESLint, pas de la revue.

## Releases

Pas de versionnage sémantique du produit pour l'instant : chaque fusion sur `main` est une release, identifiée par son SHA (Sentry, Coolify). Un `CHANGELOG.md` sera introduit quand une deuxième créatrice ou un deuxième opérateur en aura besoin.
