# 2026-11-03 — Base de l'agenda de la créatrice (CR-05, lot a) — in-progress
Fait : module `creator-tasks`. Règles pures :
- la série, avec son joker et ses paliers ;
- la journée réussie ou parfaite ;
- les dispos dans son fuseau, minuit et changements d'heure compris, sur la convention de minuit de `scheduling` (relecture d'Équipe) ;
- le placement d'une suggestion datée ;
- le refus valable la semaine visée et la suivante ;
- les coches sans doublon.

`scheduling/pure.ts` (ADR 0051). Contrats `creator-tasks.ts`. Migration 0103 : quatre tables, RLS forcée, droits par colonne. Routes `/v1/creator-space/agenda`, tâches, coches, dispos, décisions, et `/v1/creators/:creatorId/suggestions`.
Pas fait : écrans (lot b) ; écran de suggestion de l'agence, iCal, couche des shifts (lot c) ; envoi des rappels.
Décisions :
- Le joker ne compte comme dépensé que s'il sauve une journée réussie d'avant.
- Seule la routine fait la journée parfaite ; seule la routine de l'agence acceptée est essentielle.
- Une suggestion à heures ne garde son heure que dans une dispo, sur aucune tâche à heures ni sur une autre suggestion ouverte.
- Même tâche = même catégorie et même titre, sans casse, accents ni espaces.
- L'identifiant d'une tâche ou d'une dispo est tiré par son téléphone : une création rejouée ne double rien.
Découvertes : la migration 0100 (`trend_*`) n'a pas `FORCE ROW LEVEL SECURITY`, que `data-model.md` § RLS demande à chaque table avec `creator_id` (pour Bilan).
Candidats à suppression : aucun.
Vérifié : 27 tests unitaires du module ; intégration `creator-tasks-rls` (7) et `creator-agenda` (7) sur Postgres 16 local ; `check-drift` vert sur 0103.
