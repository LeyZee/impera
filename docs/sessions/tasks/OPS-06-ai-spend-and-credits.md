# OPS-06 La consommation IA et les crédits prépayés dans le CRM
Statut : review (demande de Charles du 11/11/2026, 18 h 37 ; choix et seuils : ADR 0091)
Phase : exploitation
Dépend de : `llm_calls` (P3-03), plafond du jour (`packages/llm`), alertes Telegram (P3-07)
Branche : claude/project-thread-md4sab

## Objectif
Le propriétaire voit dans Réglages › Consommation IA ce que l'IA coûte en direct et combien de jours de crédits il reste chez chaque fournisseur, et Telegram le prévient avant qu'ils manquent.

## Contexte à lire
ADR 0091, ADR 0016, `packages/llm/src/budget.ts`, `apps/api/src/modules/backups` (même forme de module), `apps/web/src/screens/dashboard/agency` (graphiques).

## À faire
- [x] Contrat `ai-usage.ts` : lecture, crédits, saisie ; événement `ai_credits_low` ; job `ai_usage.check_credits`.
- [x] Migration 0164 : `ai_credit_entries` (FORCE RLS, droits de `nirvana_app`), types d'événement élargis.
- [x] Module api `ai-usage` : domaine pur testé (dépense, rythme, projection, décompte), lecture Postgres, saisie idempotente auditée, vérification horaire dédoublonnée, routes propriétaire.
- [x] Telegram : `ai_credits_low` en « important » ou « urgent », lien vers l'écran.
- [x] Écran Réglages › Consommation IA : jour en cours face au plafond, cartes de crédits, barres empilées 30 jours / aujourd'hui, anneaux par modèle et par usage, fenêtre « Noter une recharge ».
- [ ] Captures Nuit et Jour, PC et téléphone, validées par Charles (« ok captures »).
- [ ] Tests d'intégration joués sur Postgres (CI).

## Critères d'acceptation
- Les montants de l'écran sont ceux de `llm_calls`, au centime ; un appel sans coût compte le forfait du plafond.
- Rejouer une saisie n'écrit rien deux fois ; un même identifiant avec un autre montant est refusé.
- Une alerte part une fois par seuil franchi depuis la dernière saisie.
- Seul le propriétaire lit et écrit ; aucune clé de fournisseur n'est appelée.

## Hors périmètre
La clé de gestion de xAI et toute recharge automatique ; le réglage du plafond du jour dans le CRM.

## Notes de session
