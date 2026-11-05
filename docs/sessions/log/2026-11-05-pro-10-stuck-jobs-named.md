# 2026-11-05 · PRO-10 : le Dashboard nomme les tâches bloquées

- Fiche : recette du 05/11, PRO-10 (Charles, « go recos » et « attaque tous les constats »).
- Fait :
  - `GET /v1/dashboard` renvoie `jobs.stuck`, la liste des tâches bloquées, chacune avec son libellé français (`JOB_LABELS` dans `contracts/jobs.ts`, jamais l'identifiant), son nombre et `agency` ;
  - `jobs.dead` ne compte plus que ce qui arrête son agent : ses tâches, plus la lecture des comptes Reveal (`AGENT_SYSTEM_JOBS`) ;
  - une tâche de l'agence (paie, Telegram) n'est envoyée qu'au propriétaire. L'écran la montre en « Agence · Taux de change du jour », sans ambre et sans l'ajouter au résumé ;
  - une seule tâche bloquée chez elle : « Bloqué : Envoi des messages ».
  - `countDeadJobs` devient `readStuckJobs` (par tâche).
- Tests : `dashboard.test.ts` (`stuckJobsOf` : propriétaire et autre rôle), `dashboard.integration.test.ts` (le taux de change n'entre pas dans sa santé et reste nommé), `live.test.ts`.
- Découvertes : aucune.
