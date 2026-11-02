# 2026-11-02 — lot 8 : la fiche des écrans des factures (fil Équipe) — todo
Fait : fiche `docs/sessions/tasks/EQ-06-invoice-screens.md` (même ID qu'EQ-06, comme `P3-12-desire-screens.md`) : ce que les écrans lisent déjà dans l'API, les quatre compléments d'API à faire par Équipe avant eux (la liste des documents avec `due` calculé par le serveur, `remindFrom` par pièce, l'alerte d'échéance J-7 et le lendemain de l'échéance, `documentReminderDays` dans `PUT /v1/payroll/billing-settings`), les écrans pour Extension (Mes factures, Paie › Factures, Mon dossier, Dossier de la fiche du membre, Réglages › Facturation, Paie › Exports, Aujourd'hui, finition) et les critères. EQ-06 renvoie à la fiche.
Pas fait : rien du lot 8 lui-même ; Charles n'a pas encore choisi entre le lot 8 et le gel d'Équipe après le lot 7.
Décisions : les écrans ne recalculent rien (échéance, acceptation, règlement, blocage, montant) ; `apps/web` appartient à Extension, Équipe relit chaque écran EQ et chaque montant ; les notes « au lot 8 » d'EQ-06 sont reprises dans la fiche (codes d'erreur à part, aide des régimes, guide du chatteur béninois, alerte qui lit les trois règlements et le versement bloqué).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check` (check-repo : chemins et commandes cités) ✓.
