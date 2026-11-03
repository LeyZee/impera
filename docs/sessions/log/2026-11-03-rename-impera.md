# 2026-11-03 — Renommer Nirvana en Impera : la PR mécanique (ADR 0062) — done

Fait : `scripts/rename-impera.mjs` (idempotent, testé par `scripts/rename-impera.test.mjs`) a tourné sur `main` à jour (e0b0f08), pendant le gel convenu avec le coordinateur. Il a modifié 1 056 fichiers et en a renommé 6 (`brand/nirvana-*.svg`, `apps/web/public/nirvana-mark.svg`), puis a régénéré `pnpm-lock.yaml` et passé Prettier.

Ajouts faits à la main, dans la même PR :

- migration `0099_platform_impera` : les 14 contraintes `CHECK` de plateforme acceptent `'impera'`, avec un `UPDATE` de filet entre le drop et l'add ;
- `config.ts` refuse de démarrer si une variable `NIRVANA_*` est encore posée, et donne le nouveau nom ;
- volume Docker nommé par `IMPERA_PGDATA_VOLUME` ;
- `appearance.js` reprend une fois les quatre clés `localStorage` de l'ancien nom, avec un test (`legacy-keys.test.ts`) ;
- les deux nettoyages de caches suppriment `impera-*` et `nirvana-*`, et `VERSION` de `sw.js` passe à v3 ;
- `restore-check.sh` lit `impera.dump` ou `nirvana.dump` ;
- glossaire : une ligne « Impera », et « Nirvana » dans les noms à ne pas utiliser.

Restent volontairement (ADR 0062 § 2) :

- les rôles `nirvana_app` et `nirvana_admin` ;
- la version de paie `nirvana-N`, y compris la contrainte `commission_statements_engine_check` ;
- le suffixe `@nirvana` des UID de l'agenda ;
- les migrations écrites ;
- les ADR passées, le journal, les fiches terminées et `brainstorm/` ;
- le préfixe `nv-` ;
- l'URL du dépôt et le dossier local.

Une ligne qui garde « nirvana » exprès porte « ADR 0062 » : le script la saute.

Décisions : aucune nouvelle (ADR 0062 acceptée). Migration 0099 donnée par le coordinateur ; 0098 est prise par Veille.

Pas fait :

- la PR du logo, qui part juste après (kit dans le dossier partagé, `logo-impera/kit/`), avec les six images de `docs/design/images` à refaire ;
- côté PC de Charles, par Remote Control et avec son accord (ADR § 3) : export, `ALTER DATABASE`, `.env`, `pnpm db:migrate`, puis le renommage du dossier ;
- le renommage du dépôt GitHub, qui est un geste de Charles.

Découvertes : le pre-push (`pnpm check`) manque de mémoire dans un conteneur cloud sur `@impera/api:lint`. `NODE_OPTIONS=--max-old-space-size=6144` suffit.
