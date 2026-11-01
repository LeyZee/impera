# 2026-10-27 — Dashboard : ce que voit une créatrice (ADR 0023) — done

Fait :
- Côté serveur, `GET /v1/dashboard`, lu par une créatrice, renvoie `todos` et `fans` vides. Le test d'intégration vérifie qu'aucun prénom de fan n'est dans la réponse.
- Les chiffres de l'agence sont aussi à `null` pour elle : `budget.spentToday` (contrat rendu nullable, à la demande de Bilan) et `jobs.dead`.
- À l'écran (`DashboardPage forCreator`, posé par le routeur selon le rôle) :
  - pas de « À traiter » ni de « Voir l'urgence » ;
  - pas de Meilleurs fans ni de lecteur, et donc aucun lien vers Suivi ;
  - pas de bandeau de nuit Telegram ;
  - le mode est en lecture seule (« Le mode de l'agent se change par l'agence. »), puisque `PUT /v1/agent/mode` refuse déjà la créatrice ;
  - la clé manquante devient « L'agence s'en occupe », sans lien vers Réglages ;
  - le pli de santé n'a plus la carte Budget IA, la ligne « Tâches bloquées » ni « À poser dans Réglages ».
Ce que la créatrice garde : l'état et le mode de l'agent, sa santé (agrégats), les ventes quand elles seront lues.
Pas fait : rien dans ce fil.
Décisions : la lecture de l'ADR 0023 par le coordinateur (agrégats seulement, aucune urgence nominative). Les deux listes restent dans le contrat, vides. `budget.spentToday` devient nullable.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓. Le test d'intégration tourne en CI, faute de Docker ici.
