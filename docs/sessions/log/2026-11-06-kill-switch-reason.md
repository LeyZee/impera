# 2026-11-06 — Raison du coupe-circuit, test du hook gitleaks

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point 5 de la relecture des données gardées tranché par Charles (06/11)

## Fait

- `pnpm ops:kill-switch` : le message d'usage et l'en-tête du script disent que la raison est gardée telle quelle, qu'elle décrit la cause et ne nomme jamais un fan.
- `docs/runbooks/incident.md` § 0 : même consigne, avec deux exemples de raison.
- Aucun écran web ne fait saisir de raison (vérifié par Extension) : rien côté web.
- `scripts/gitleaks-hook.test.mjs` (signalé par Médias) : lancé depuis le pré-push d'un `git worktree`, le test héritait de `GIT_DIR` et des variables voisines. Son `git init` et ses deux commits visaient alors le vrai dépôt (`core.bare=true`, un commit avec un faux jeton). Le test les lance maintenant sans aucune variable `GIT_*`, il vérifie que chaque commande `git` réussit et que la racine est bien le dossier temporaire. Lancé avec `GIT_DIR` exporté : 8/8 verts, le vrai dépôt n'a pas bougé.

## Reste

- Rien.

## Découvertes

- Aucune.
