# 2026-11-06 — Balayage d'origine

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point 2 de la suite de l'audit des tests d'isolation (06/11)

## Fait

- `apps/api/src/__tests__/origin-sweep.integration.test.ts` : chaque route d'écriture (POST, PUT, PATCH, DELETE), lue depuis le serveur, est appelée une fois depuis un autre site et une fois sans `Origin`. Elle doit répondre 403 `origin_forbidden` avant toute autre chose. Seules quatre routes y échappent, chacune authentifiée autrement : la session de l'extension (jeton d'appareil), les deux portes de la veille (jeton de liaison) et le webhook des ventes (signature). Le balayage d'authentification prouve déjà que ces quatre routes répondent 401 sans leur jeton.
- Relecture #595 (Agent) : les deux balayages refusent désormais une route à joker (`*`) au lieu de l'ignorer, et le commentaire du balayage d'authentification dit qu'un 400 ou un 404 rendu avant la garde est signalé exprès.
- Résultat : aucune écriture n'est ouverte à un autre site.

## Reste

- Fin de #588 (profil et pièces du prestataire, estimation, chatteur en shift ouvert), puis séparation de l'éval du nightly.

## Découvertes

- Aucune.
