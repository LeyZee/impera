# 2026-10-28 — Recette complète : le job des taux BCE refusait chaque passage du cron — done
Fait : `payroll.fetch_exchange_rates` avait un contenu strict (`z.strictObject({})`) ; le cron de Graphile ajoute `_cron` au contenu de chaque passage, donc chaque passage échouait en « Invalid payload » avant tout appel réseau : aucun taux lu, l'alerte de taux manquant muette, et une quinzaine avec un rapport en dollars ne se calculait plus (`exchange_rate_missing_conflict`). Le contenu redevient `z.object({})` comme les autres jobs périodiques, et un test vérifie que chaque job du cron accepte ce que le cron lui envoie.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `crontab.test.ts` ✓ ; `pnpm check` et `pnpm test`.
