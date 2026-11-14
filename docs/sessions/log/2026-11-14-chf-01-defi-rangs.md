# 2026-11-14 — CHF-01 Chiffres et jeu du chatteur, défi du shift et rangs — in_progress
Fait : seconde PR du jeu (ADR 0104 § 14, § 16, § 20) : défi du shift (médiane de ses propres shifts comparables, `GET /v1/rewards/my-shift-challenge`, carte sur Aujourd'hui) ; huit rangs fixes avec leurs insignes, seuils réglés par le propriétaire (`reward_level_settings`, migration 0203 provisoire, `GET`/`PUT /v1/rewards/level-thresholds`, carte dans Paie › Objectifs), carte « Mon rang » sur Commissions, dévoilement d'un rang ; bloc « Jeu » en lecture sur la fiche d'un membre (`GET /v1/rewards/members/:memberId/trophy-case`) ; glossaire (« Rang », « Insigne », « Défi du shift »), note dans l'ADR 0104, README du module.
Pas fait : captures à faire valider par Charles, relectures (Équipe, Bilan, Design), numéro de migration à confirmer au signal de fusion ; lot 3.
Décisions : aucune ADR nouvelle ; choix de Charles du 14/11 noté dans l'ADR 0104 (rangs fixes, seuils à lui ; « à l'heure » = 12 h).
Découvertes : `beatsRecord` accepte un plus haut antérieur nul ou négatif ; la lecture des faits du jeu pourrait se faire en transaction en lecture seule ; aucun mot quand l'enregistrement de « Sons » échoue.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; tests d'intégration joués par la CI seulement (pas de Docker dans la session).
