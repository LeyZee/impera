# 2026-11-02 — CRM-01 Confirmer un lien de modèle posé par le pseudo — in-progress
Fait : `PUT /v1/settings/sales-feeds/:plateforme/models/:modèle` vers le compte déjà lié par le pseudo confirme le lien (il passe au propriétaire, daté, ligne `sales_feed.model_linked` avec `confirmed`) ; le confirmer de nouveau ne change rien. Test d'intégration.
Pas fait : rien d'autre ; l'écran est la #412 (Extension).
Décisions : même action d'audit que le lien, marquée `confirmed`, pour que CRM-03 lise une seule histoire des liens.
Découvertes : la référence de paie (`payroll-reference.integration.test.ts`) écrivait la date d'échéance, qui suit le jour d'émission : rouge sur `main` depuis minuit à Paris le 03/11. Corrigé dans cette PR (CI) : la mention écrit `JJ mois AAAA` et la référence garde le nombre de jours (`dueInDays`).
Candidats à suppression : aucun.
Vérifié : voir la PR (pnpm check, tests d'intégration `sales-feed`).
