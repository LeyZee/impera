# Par où commencer

Ce dépôt est conçu pour être travaillé par des sessions d'agents codeurs (Claude Opus 5.5 via Claude Code), une tâche à la fois, sous l'architecture définie par Charles et Claude Fable 5.1. Ce fichier dit quoi lire, dans quel ordre, selon ce que tu as à faire. Compte 10 minutes de lecture avant la première ligne de code : c'est rentable.

## Toujours (5 min)

1. `CLAUDE.md` : les règles.
2. `docs/sessions/README.md` : comment se déroule une session (début, pendant, fin).
3. Ta fiche de tâche dans `docs/sessions/tasks/`. Elle liste les docs spécifiques à lire.
4. `docs/sessions/LOG.md` (index) et les 5 dernières entrées de `docs/sessions/log/` : ce que les sessions précédentes ont fait, découvert, laissé.

## Selon la tâche

| Si ta tâche touche… | Lis aussi |
|---|---|
| N'importe quel code | `docs/architecture/overview.md`, `docs/architecture/modules.md`, `docs/conventions/coding.md`, `docs/conventions/security.md` (checklist PR), `docs/glossary.md` |
| La base, les entités, les migrations | `docs/architecture/data-model.md`, `docs/architecture/jsonb.md`, ADR 0005, 0007, 0011, `docker-compose.yml` |
| L'ingestion, les drafts, l'envoi | `docs/architecture/message-flow.md`, ADR 0006, 0007 |
| Une route HTTP, l'API du dashboard | `docs/conventions/api.md`, `docs/conventions/security.md` §6 |
| Un connecteur (Reveal, Fake, plateforme propre) | `docs/architecture/connectors.md`, ADR 0008, `docs/reference/reveal-api-observed.md`, `docs/playbooks/add-a-connector.md` |
| Le moteur IA, les prompts, un fournisseur | `docs/architecture/ai-engine.md`, ADR 0009, 0012, `docs/playbooks/add-an-llm-provider.md`, `docs/reference/media-vocabulary.md`, `docs/reference/llm-providers.md` |
| La persona | `docs/reference/persona-schema.md`, ADR 0010, `docs/playbooks/edit-the-persona.md` |
| La qualité conversationnelle, les évals | `docs/playbooks/write-an-eval.md`, `evals/README.md` |
| Le dashboard, la PWA | `apps/web/README.md`, `docs/architecture/message-flow.md` (mode copilote) |
| Le design, un composant d'interface | `docs/design/README.md`, `packages/design-system/README.md`, ADR 0015 |
| Le logo, la bannière, le favicon | `brand/README.md` |
| L'extension | `apps/extension/README.md`, `docs/architecture/connectors.md` |
| La future plateforme propre | `docs/architecture/own-platform.md`, ADR 0003 |
| La sécurité (auth, secrets, données, injection) | `docs/conventions/security.md`, `docs/architecture/threat-model.md` |
| L'exploitation, un incident, un secret, une restauration | `docs/architecture/operations.md`, `docs/runbooks/` |
| Du nettoyage | `docs/conventions/hygiene.md`, ADR 0014, `scripts/check-repo.mjs` |
| L'outillage, les commandes, la CI | `package.json` (définition des commandes), `.github/workflows/ci.yml`, `docs/conventions/testing.md` |

## Où est la vérité

- **Décisions** : `docs/adr/`. Un ADR accepté s'applique. Pour le contredire, on écrit un nouvel ADR qui remplace l'ancien, après accord de Charles.
- **Architecture courante** : `docs/architecture/`. Si le code et la doc divergent, la doc est à corriger dans la même PR que le code.
- **Historique du raisonnement** : `brainstorm/` et le cahier des charges, à la racine du dépôt, contiennent les échanges d'origine. Utile pour comprendre le pourquoi, pas une source de règles : les ADR et `docs/architecture/` priment.
- **Roadmap** : `docs/roadmap.md`. Les fiches de tâches en découlent.

## Ce que ce dépôt n'est pas

- Pas une copie d'Imperium ni d'OnlyScript. Leurs concepts sont reconstruits de zéro dans Nirvana (l'équipe et la paie d'Imperium par l'ADR 0023, les scripts d'OnlyScript en second temps), aucun code repris (voir `docs/reference/legacy-projects.md`).
- Pas un SaaS multi-agences pour l'instant. Une créatrice (Messalina), une plateforme (Reveal), un objectif : fiabilité du connecteur, qualité du chatting, propreté de l'architecture.
