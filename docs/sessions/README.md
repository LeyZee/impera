# Sessions d'agents codeurs : le protocole

Le projet avance par sessions. Une session = un agent (Claude Opus 5.5 dans Claude Code, en général), une fiche de tâche, une branche, une PR. Charles lance les sessions ; Claude Fable 5.1 (architecte) écrit les fiches et revoit les ADR. Ce document est le contrat entre les trois.

## Le cycle d'une session

### 1. Démarrage (10 min)

- Lire `CLAUDE.md`, `docs/00-START-HERE.md`, ta fiche dans `docs/sessions/tasks/`, les docs qu'elle liste, et les 5 dernières entrées de journal (`pnpm sessions:log 5`, le détail est dans `docs/sessions/log/`).
- Prérequis sur la machine : Node 22 (`.nvmrc`), pnpm 10, Docker, `gitleaks` sur le PATH.
- Vérifier l'état : `git status` propre sur `main` à jour (`git fetch origin main`), `pnpm install` (installe les hooks), `docker compose up -d`, `pnpm check` vert. Si ce n'est pas vert avant de commencer, tu le notes dans ton entrée de journal et tu t'arrêtes : ce n'est pas à toi de réparer en passant, sauf si ta fiche le dit. Depuis le 16/10, `pnpm check`, `pnpm test` et la CI sont verts sur le squelette (seul `packages/design-system` a du code).
- Créer la branche, en minuscules : `task/<id>-<slug>` (ex. `task/p0-03-database`, le nom exact est dans la fiche).
- Passer la fiche en `in_progress` (champ `Statut :` en tête de fiche, et la ligne de l'index `docs/sessions/tasks/README.md`) et commiter ce seul changement.

### 2. Pendant

- **Périmètre** : la fiche, rien que la fiche. Ce qui dépasse va dans ton entrée de journal (« Découvertes ») ou dans une nouvelle fiche en statut `proposed` (`docs/sessions/tasks/PROPOSED-<slug>.md`, sans ID tant que Charles ne l'a pas acceptée), jamais dans la PR.
- **Sessions en parallèle** : d'autres fiches avancent peut-être en même temps sur d'autres branches. Avant la PR : `git fetch origin main && git rebase origin/main`, jamais de commit de fusion. Deux sessions ne prennent jamais la même fiche : Charles les attribue.
- **Ordre** : contrats (Zod) → domaine (pur, testé) → application → infra → UI. On écrit le test du domaine avant ou avec le code.
- **Frontières** : `pnpm lint` à chaque étape ; une erreur de frontière se résout en déplaçant le code, pas en désactivant la règle.
- **Décision structurante** (nouvelle dépendance de poids, nouveau pattern, changement de contrat partagé, choix qui engage plusieurs modules) : tu écris un ADR en statut `proposed` et tu t'arrêtes là-dessus en le signalant dans la PR. Tu n'implémentes pas une décision non acceptée si elle contredit un ADR existant.
- **Commits** : petits, conventionnels (`feat(conversations): …`, `fix(connectors): …`, `chore(cleanup): …`, `docs: …`, `test: …`). Un commit compile et passe les tests.
- **Données** : jamais de vraie donnée de fan, de créatrice ou de session dans un test, une fixture, un log ou une doc. Les fixtures sont inventées et évidemment fausses.

### 3. Fin (15 min, obligatoire)

1. `pnpm check` vert, `pnpm test:all` vert (unitaire + intégration, Docker lancé pour Testcontainers).
2. Nettoyage selon `docs/conventions/hygiene.md`.
3. Docs touchées par la tâche mises à jour (architecture, README de module, playbook).
4. Fiche mise à jour : `status: done` ou `blocked` avec ce qui manque, et la section « Résultat ».
5. Entrée de journal (format ci-dessous) dans son propre fichier ; rien d'autre à toucher, le dossier est l'index.
6. Branche rebasée sur `origin/main`, PR ouverte par la session (en brouillon dès que ça compile, « prête » quand tout est vert) avec le template, titre = id + titre de la fiche. La PR décrit « avant / après » en français simple. Charles fusionne.

## Format d'une entrée de journal

Une entrée = un fichier `docs/sessions/log/<AAAA-MM-JJ>-<slug-en-minuscules>.md` (ex. `2026-10-20-p0-03.md`), jamais modifié par une autre session, dont la première ligne commence par `# <AAAA-MM-JJ>` (vérifié par `scripts/check-repo.mjs`). Le dossier est l'index : aucune session n'édite un fichier partagé, donc deux PR en parallèle n'entrent jamais en conflit sur le journal. Le tableau de `docs/sessions/LOG.md` est figé à ses 153 lignes du 27/10/2026, et `scripts/check-repo.mjs` refuse une ligne de plus. `pnpm sessions:log` liste les entrées dans l’ordre où elles sont entrées dans le dépôt (d’après git), la dernière d’abord.

```
# 2026-10-20 — P0-03 Base de données — done
Fait : schéma Drizzle du noyau, migrations avec RLS, withTenant/withAdmin, chiffrement des sessions, test d'isolation RLS.
Pas fait : tables de la phase 6 (hors périmètre).
Décisions : ADR 00NN proposée (exemple : stratégie de numérotation de `seq`).
Découvertes : le schéma `messages` manque un index sur (conversation_id, platform_created_at).
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (41 tests), hygiène ✓.
```

Les entrées sont figées : on n'en réécrit jamais une ancienne. `docs/sessions/LOG.md` porte en plus deux listes vivantes, « Candidats à suppression » et « Incidents », que toute session peut compléter d'une ligne.

## Rôles

- **Charles** : décide, lance les sessions, valide les PR et les ADR. Donne l'accès aux comptes (Reveal, fournisseurs LLM).
- **Fable 5.1 (architecte)** : écrit et met à jour les fiches, les ADR, l'architecture ; revoit les PR structurantes ; arbitre les candidats à suppression.
- **Opus 5.5 (sessions)** : exécute les fiches dans ce protocole.

## Lancer une session (pour Charles)

Message de départ d'une session Opus 5.5 dans Claude Code, à la racine du dépôt :

```
Tu es une session de code Nirvana. Lis CLAUDE.md puis docs/00-START-HERE.md, puis ta fiche docs/sessions/tasks/<ID>-<slug>.md. Suis le protocole de docs/sessions/README.md du début à la fin. Fiche : <ID>.
```

## Quand s'arrêter et demander

- La fiche est ambiguë sur un point qui change le résultat visible.
- Une étape demanderait une action irréversible (suppression de données, migration destructive, envoi réel, dépense).
- Un ADR existant bloque la solution évidente.
- Un secret, une donnée réelle ou un comportement suspect apparaît.

Dans ces cas : on écrit la question dans la PR ou dans son entrée de journal, on passe la fiche en `blocked`, et on s'arrête proprement (étape 3 complète quand même).
