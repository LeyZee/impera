# 2026-11-06 — Balayage d'authentification

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point 1 de la suite de l'audit des tests d'isolation (06/11)

## Fait

- `apps/api/src/__tests__/authentication-sweep.integration.test.ts` : chaque route de l'API, lue depuis le serveur lui-même (`printRoutes`), est appelée sans session, avec l'origine du dashboard, ses paramètres remplis et une adresse par requête (pour que le limiteur ne cache rien). Toute réponse autre que 401 doit appartenir à la liste `PUBLIC`, qui compte 16 routes, chacune avec la raison pour laquelle elle s'ouvre sans session. Une route ajoutée demain sans sa garde fait échouer le test jusqu'à ce qu'elle reçoive sa garde ou entre dans la liste.
- `apps/api/src/__tests__/support/routes.ts` : la lecture des routes est sortie du test d'isolation pour être partagée avec ce balayage et le suivant (origine).
- Résultat : aucune route n'est ouverte sans raison.

## Reste

- Balayage d'origine (CSRF), puis fin de #588, puis séparation de l'éval du nightly.

## Découvertes

- Aucune.
