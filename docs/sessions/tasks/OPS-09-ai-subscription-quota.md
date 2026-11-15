# OPS-09 Un fournisseur d'IA payé par l'abonnement, alerte au quota épuisé
Statut : in_progress (« ok 0091 abonnement » de Charles, 13/11/2026, 2 h 03 ; ADR 0091 § 6)
Phase : exploitation
Dépend de : OPS-08 (Réglages › Consommation IA), ADR 0091
Branche : claude/project-thread-md4sab

## Objectif
Un fournisseur payé par l'abonnement du propriétaire (Grok chez Charles, quota hebdomadaire) n'a plus de crédits à décompter, et Telegram prévient dès que le quota est épuisé, pendant que l'agent répond avec son modèle de repli.

## Contexte à lire
ADR 0091 (§ 6), `packages/llm/src/call-runner.ts` (classement des erreurs), `apps/api/src/modules/ai-usage`, `apps/web/src/settings/ai-usage`.

## À faire
- [x] Passerelle : un refus faute de crédits ou de quota devient `quota_exhausted`, sans réessai, sans marquer la clé « à reconnecter », sans garder la réponse du fournisseur.
- [x] Migration 0204 : `subscription` dans le registre, statut `quota_exhausted` indexé, événement `ai_quota_exhausted` (contrôles de type, déclencheur Telegram).
- [x] Module `ai-usage` : carte « Inclus dans l'abonnement », premier refus depuis la dernière réponse, alerte une fois par épisode, vérification toutes les cinq minutes.
- [x] Telegram : `ai_quota_exhausted` en « urgent ».
- [x] Écran : choix « Payé par l'abonnement » dans la fenêtre de saisie, carte sans solde, rouge « Quota épuisé ».
- [x] Captures Nuit et Jour, PC et téléphone, validées par Charles (lot conso-ia-abonnement-2, 13/11).
- [x] Chiffres (« ok 0091 chiffres », 13/11, 2 h 56) : « dont X € couverts par l'abonnement » sous Aujourd'hui, Ce mois-ci et Prévu fin du mois ; part couverte hachurée dans le graphique ; le plafond compte tout.
- [ ] Captures des chiffres validées par Charles (lot conso-ia-chiffres).

## Critères d'acceptation
- Une ligne `subscription` porte un montant nul ; une recharge ou un solde noté après reprend le décompte.
- Un 403 ou 429 dont la réponse dit l'épuisement (quota insuffisant, crédits épuisés, limite de dépense atteinte) n'est ni réessayé ni signalé comme clé refusée ; un 403 sans ces mots l'est toujours, et un 429 avec `retry-after` ou qui ne dit pas l'épuisement reste un débit, réessayé.
- Une seule alerte par épisode de refus ; une réponse du fournisseur clôt l'épisode.
- Une dépense est couverte entre une ligne `subscription` et la recharge ou le solde suivant du même fournisseur, à l'heure près ; la part couverte du jour ne dépasse jamais ce que compte le plafond.

## Hors périmètre
Lire le pourcentage du quota (aucune API ne le donne) ; la clé de gestion de xAI.

## Notes de session
