# 2026-11-03 — CRM-02 Dernier rapport réaffiché — in-progress (l'écran est fait)
Fait : `CheckPanel` lit `GET …/sales-feeds/:plateforme/check` au chargement et réaffiche le dernier rapport gardé ; après une vérification, il relit `clean` du serveur pour le rapport qu'il vient de garder. `CheckReport` dit quand le rapport a été fait et combien de temps avant le registre avait été lu ; une ligne dit si la bascule pourra s'appuyer dessus, et sinon pourquoi (`switchLine`, `isWholeFortnight`, `readBefore` dans `check.ts`). La note d’un bot relié à un membre suit le lien du rapport, et ne nomme le membre qu’après une vérification lancée sur la page (un rapport gardé ne dit pas quel membre il a vu). 9 tests de plus.
Relecture Équipe : d’accord ; « Sur 1 jours » accordé au passage.
Pas fait : `checkedBy` n'est pas affiché (un seul propriétaire aujourd'hui ; le nommer demanderait l'utilisateur courant dans Réglages).
Décisions : la règle « propre » reste au serveur, l'écran n'en dérive que la phrase ; un échec de lecture du dernier rapport ne montre rien (le formulaire suffit pour relancer).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check` ; tests web ; captures Nuit et Jour, 1440 et 390 px, sans défilement horizontal (`/mnt/project-files/reglages-ventes/crm-02/reaffichage/`).
