# 2026-11-06 · Robustesse : essais des jobs périodiques, cause des échecs de scripts, test des réglages de vente Telegram

- Fil : Bilan. Branche `claude/project-thread-a8l1w6`.
- Fait : chaque entrée du planificateur (`apps/api/src/crontab.ts`) prend son nombre d'essais dans le contrat (`JOB_MAX_ATTEMPTS`). Les bilans Telegram du soir (3 essais au contrat) et du matin (passé à 3) étaient forcés à un seul essai, si bien qu'un échec à leur heure perdait le bilan du jour ; la clé du jour les garde uniques. Seul le scan de la minute garde un essai (`SCAN_SAFETY_NET_ATTEMPTS`), la minute suivante étant sa reprise. `scripts.ask_scripts` écrit désormais, pour chaque créatrice en échec, la cause dans le journal du worker (`onFailure`, niveau warn), en plus du compte.
- Tests : `crontab.test.ts` impose que chaque entrée suive le contrat ; unitaire `ask-scripts` (cause transmise) ; intégration `telegram-wiring` pour `GET`/`PUT /v1/settings/telegram/sales` (valeurs par défaut, enregistrement, créatrice inconnue refusée sans rien changer, doublon refusé, équipe en 403).
- Décisions : pas de rattrapage (`backfillPeriod`) pour les bilans, qui calculent leur heure sur l'horloge du passage ; les réessais suffisent dans l'heure.
- Découvertes : aucune.
