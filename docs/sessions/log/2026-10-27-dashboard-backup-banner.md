# 2026-10-27 — Dashboard : bannière des sauvegardes pour le propriétaire (OPS-02) — done

Fait : le Dashboard du propriétaire lit `GET /v1/backups/status`. Quand la sauvegarde est en retard (`overdue`), il affiche une bannière ambre « Aucune sauvegarde réussie depuis le … ». Quand il n'y en a jamais eu (`never`), il affiche « Aucune sauvegarde encore ». La bannière dit aussi si la dernière tentative a échoué ou si une sauvegarde est en cours. Elle n'a pas d'action, puisque rien dans l'application ne la corrige. Elle n'affiche jamais le texte d'erreur du service. Rien ne s'affiche quand tout est à l'heure, sur l'exemple, ni pour un autre rôle, et la route n'est alors même pas appelée.
Pas fait : rien dans ce fil.
Décisions : si la route échoue, la bannière se tait. C'est le Dashboard entier qui dit déjà « Le serveur ne répond pas ».
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests du Dashboard ✓ (`backups.test.ts`, `DashboardPage.test.tsx`).
