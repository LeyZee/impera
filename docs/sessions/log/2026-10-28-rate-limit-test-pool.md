# 2026-10-28 — Test du limiteur stable sur une CI chargée — done
Fait : les tests qui comptent les requêtes (`rate-limit-store.integration.test.ts`) passent par un pool du limiteur aux délais larges (10 s pour se connecter et par requête) au lieu des bornes de production (500 ms, 200 ms). Sur un runner froid, une requête non comptée passait sans être limitée (`skipOnError` du limiteur global), et la 5e requête rendait 401 au lieu de 429 (run 40621743141 sur #245). Le cas « Postgres trop lent » reste testé sur le pool de production. Les fixtures de `alert-history.integration.test.ts` portent `notify`, comme le contrat d'`alert_triggered` le demandera avec la PR B2.
Pas fait : rien.
Découvertes : aucune.
Candidats à suppression : aucun.
