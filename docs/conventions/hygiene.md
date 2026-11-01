# Hygiène du dépôt : propre en permanence

Demande explicite de Charles : le dépôt doit rester **propre à tout moment**. Pas « léger à tout prix » (la taille a un coût mais ce n'est pas l'objectif), mais **sans fichiers parasites, scripts morts, brouillons oubliés, docs périmées**. Et on fait attention à ce qu'on supprime : on ne supprime pas n'importe quoi.

## Principe

Tout fichier du dépôt doit avoir une raison d'exister que quelqu'un peut nommer en une phrase. Si personne ne peut, il part.

## Le temporaire a une maison : `.scratch/`

- Tout script jetable, sortie de débogage, export, note de travail, fichier de test manuel va dans `.scratch/` à la racine. Ce dossier est ignoré par git.
- Chaque session travaille dans un sous-dossier à son nom de fiche (`.scratch/p0-03/`) et ne supprime que ses propres fichiers avant de terminer. `.scratch/inbox/` est réservé à Charles (ce qu'il dépose pour une session) : on y lit, on n'y supprime rien.
- Rien d'autre ne sert de fourre-tout : pas de `tmp/`, pas de `test.ts` à la racine, pas de `old/`, pas de `*.bak`, `*.orig`, `*.copy`, `*-v2`, `*_final`.

## Avant de terminer une session (obligatoire)

1. `git status` : chaque fichier nouveau ou modifié est voulu, nommé selon les conventions, à sa place.
2. Tu supprimes **ce que tu as créé** dans la session et qui ne sert plus : scripts d'exploration, fixtures d'essai, `console.log` de débogage, commentaires `TODO` que tu as traités, branches locales mortes.
3. Tu vérifies que tu n'as pas laissé : de code commenté « au cas où », de fonctions inutilisées, de dépendance ajoutée puis abandonnée (`package.json`), d'export inutile.
4. `pnpm check` passe `knip` (code et dépendances mortes) et `scripts/check-repo.mjs` (noms interdits, `TODO` sans fiche, fichiers lourds, index des fiches et ADR, commandes citées, scripts délégués aux paquets et fichiers qu'ils lancent) : zéro nouveau signalement.
5. Les docs que ta tâche rend fausses sont corrigées dans la même PR. Une doc périmée est pire qu'une doc absente.

## Supprimer un fichier que tu n'as pas créé

Procédure, dans l'ordre, et on s'arrête dès qu'une étape dit non :

1. Le fichier est-il dans la **liste protégée** ci-dessous ? Si oui, on ne le supprime pas ; on le signale dans le LOG avec la raison.
2. `rg` sur son nom et sur ses exports : est-il référencé quelque part (code, config, docs, CI, scripts) ? Si oui, on ne le supprime pas sans traiter ces références dans la même PR.
3. `git log --follow` : a-t-il été modifié dans les 30 derniers jours par une autre tâche ? Si oui, on demande dans le LOG avant de supprimer.
4. Sinon, on le supprime **dans un commit séparé** intitulé `chore(cleanup): remove <chemin> (<raison en 5 mots>)`, pour que ce soit trivial à annuler.

En cas de doute : on ne supprime pas, on écrit une ligne dans `docs/sessions/LOG.md` section « Candidats à suppression » avec le chemin et la raison. Charles ou la session de nettoyage tranche.

## Liste protégée (jamais supprimés sans ADR ou accord explicite)

- `docs/adr/**` (un ADR se remplace, ne se supprime pas)
- `docs/sessions/LOG.md`, `docs/sessions/tasks/**` (les fiches terminées restent, statut `done`)
- `packages/db/migrations/**` appliquées
- `personas/**` (toute version, même inactive)
- `evals/**` datasets et enregistrements `FakeReveal` (`apps/api/src/__tests__/fake-reveal/recordings/**`, versionnés et anonymisés)
- `docs/reference/reveal-api-observed.md`
- `.github/**` ; `brainstorm/` et `Contexte et cahier des charges — Agent IA Reveal.md` (historique du raisonnement, à la racine).

## Session de nettoyage périodique

Une fiche `H-xx` (hygiène) est planifiée après chaque phase de la roadmap : passage `knip`, `depcheck`, recherche de docs sans `Dernière revue` récente, fichiers non référencés, branches distantes fusionnées à supprimer. Elle produit une PR de nettoyage uniquement, sans changement fonctionnel.

## Ce qui n'est pas du parasite

- Un test qui échoue volontairement en attendant une fonctionnalité (`it.todo`) : oui, s'il est lié à une fiche.
- Un `.gitkeep` dans un dossier vide de la structure cible : oui.
- Un fichier de référence volumineux (enregistrement HAR anonymisé, dataset d'éval) : oui, s'il est utilisé par un test ou une éval et documenté.
