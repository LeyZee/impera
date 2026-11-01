# 2026-10-22 · Dashboard : les jobs sans tâche du worker comptent comme bloqués (suite de R-G6)

Fait :
- `countDeadJobs` compte aussi les jobs en retard de 15 minutes dont aucune tâche du worker ne porte le nom (`conversation.follow_up`, `fans.refresh_summary`, `media.describe` aujourd'hui) : Graphile les garde en file pour toujours sans consommer d'essai. La racine de composition passe la liste des tâches du worker.
- Contrat (`jobs.dead`, commentaire) et `operations.md` le disent.
- Test d'intégration : un job sans tâche en retard d'une heure compte, le même dû maintenant ne compte pas, un job d'une tâche connue en retard ne compte pas.

Pas fait : `/ready` garde son compte global des jobs abandonnés seulement.

Décisions : même champ `jobs.dead` plutôt qu'un second compteur : pour l'écran, les deux veulent dire « du travail qui ne se fera pas sans quelqu'un ». Délai de 15 minutes : au-delà de la plus longue attente normale d'un job (debounce, relance).

Relectures : agent (suite de sa remarque sur #111).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `apps/api`.
