# OPS-10 Les images Docker ne se disputent plus le cache pnpm
Statut : done
Phase : exploitation
Dépend de : OPS-03
Branche : task/ops-10-docker-pnpm-store (fil « Bilan »)

## Objectif (1 phrase)

Que le job « Docker images » de la CI ne tombe plus par intermittence sur `ERR_PNPM_NO_OFFLINE_TARBALL`.

## Contexte à lire (fichiers précis)

- `apps/api/Dockerfile`, `apps/web/Dockerfile`.
- `.github/workflows/ci.yml`, job « images » (`docker compose up -d --build`).

## Cause

Les deux Dockerfiles montent le même cache `id=pnpm` en mode partagé, et compose construit l'image de l'API (migrate, api, worker) et celle du web en même temps. La récupération des paquets de l'une écrit dans le magasin pendant que l'installation hors ligne de l'autre le lit : l'installation trouve un paquet à moitié écrit et refuse de télécharger.

## À faire (liste vérifiable)

- [x] `sharing=locked` sur chaque montage du cache pnpm (API : 3, web : 2) : une seule construction à la fois dans le magasin.
- [x] `--prefer-offline` au lieu de `--offline` : un paquet absent du magasin est téléchargé au lieu de faire échouer la construction.

## Critères d'acceptation (tests, commandes, comportements observables)

- Le job « Docker images » est vert sur la PR ; les images construites sont les mêmes (même lockfile, `--frozen-lockfile`).

## Hors périmètre

- Cache de couches GitHub Actions pour Docker, construction unique de l'image de l'API.
