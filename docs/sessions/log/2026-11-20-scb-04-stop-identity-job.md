# 2026-11-20 — SCB-04 Arrêt du job d'identité des scripts natifs (ADR 0161 § 5) — done
Fait : plus rien ne met en file `scripts.identify_platform_script`, le job qui fait écrire par le cerveau (payant) l'identité d'un script natif, que l'agent ne lit plus depuis ADR 0161 : l'import n'en demande plus (`askIdentities` retiré), la validation ou la correction d'une description non plus, et `scripts.identify_backlog` sort de `crontab.ts`. Le job et la tâche de rattrapage restent définis, demandés par personne ; les identités déjà écrites restent, ignorées. Le module des scripts perd un accès par le rôle de service (`enqueue`) : plafond 20 → 19. Tests : aucun job après une description validée ou un import qui change un script ; plus de rattrapage horaire dans la crontab.
Pas fait : retirer le job, sa tâche et leurs contrats (voie ordonnée, `packages/contracts`), et les droits d'écriture d'identité de `nirvana_app` (migration, Sécurité). Un job déjà en file avant le déploiement peut encore tourner une fois.
Décisions : aucune (ADR 0161 § 5).
Découvertes : aucune.
Candidats à suppression : `identify-platform-script.ts`, `script-identifier`, `enqueueBacklog` et les deux tâches, quand Charles confirme qu'on ne revient pas aux identités.
Vérifié : typecheck API, tests du module scripts, crontab et plafond du rôle de service ; intégration en CI.
