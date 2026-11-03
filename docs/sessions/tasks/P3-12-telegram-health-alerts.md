# P3-12 Alertes Telegram : plafond IA en rouge, connexion en panne

Statut : in_progress. Lot 1 fait ; lot 2 : contrat et publieurs `connection_state_changed` livrés par Bilan (migration 0093), rendu Telegram à faire.
Phase : P3 (notifications, ADR 0020)
Décision : Charles, 03/11/2026 11h14 (« comble ce trou-là », « je veux bien cette alerte », bot unique à l'agence), 2 h avant le rouge accepté le même jour.
Dépend de : P3-07 (fait). Lot 2 : l'événement `connection_state_changed` (Bilan, migration 0093).
Code : le fil Telegram pour `telegram` ; Bilan pour le contrat, la migration et les publieurs (`providers`, `connectors`). Relectures : Bilan pour tout ce qui touche `contracts`, `db`, `providers`, `connectors` ; Extension pour l'écran.

## Objectif

Le groupe d'alertes de l'agence apprend tout de suite qu'une connexion dont dépend l'agent est tombée, et que le plafond IA du jour est atteint. Chaque panne donne une alerte, une seule relance si elle dure, puis « Rétabli ». Un compte de créatrice n'a pas de bot à lui : le bot est un outil d'agence.

## Ce qui existe déjà

- `budget_threshold_crossed` (80 % et plafond atteint, une fois par jour et par seuil) sonne dans « Important ».
- `session_state_changed` couvre la capture Reveal de l'extension : « La session Reveal a expiré » puis « Résolu : la session est revenue ».
- Réglages › Telegram montre déjà un bot en panne : Telegram ne peut pas annoncer sa propre panne.

## Lot 1 : plafond IA atteint en rouge (`telegram`)

- [x] Le plafond atteint passe en `urgent` (« URGENT ») : toute génération s'arrête jusqu'à minuit. Les 80 % restent en `important`.
- [x] Le sous-titre des sujets dans Réglages › Telegram le dit. L'ADR 0020 §§ 2 et 3 est mise à jour.

## Lot 2 : connexion en panne

### Le contrat (Bilan)

- `connection_state_changed`, `creator_id` null, publié **à la transition seulement**, jamais à chaque vérification. Union discriminée sur `state` :
  - `{ service, state: 'down', reason, since }`, où `reason` vaut `refused`, `low_credit` ou `unreachable` (aucune source ne distingue une clé expirée d'une clé refusée : les deux sont `refused`) ;
  - `{ service, state: 'back', since }`.
- `service` vaut `xai`, `mistral`, `google`, `elevenlabs` ou `reveal_crm`. `meta` entre avec son publieur (PUB-02), pas avant. Venice, en secours, n'est pas surveillé.
- Jamais la clé, jamais un extrait de réponse du service.
- La règle de bascule vit chez le publieur, en code. Un refus d'authentification (401/403) ou un crédit bas passent `down` tout de suite. `unreachable` ne passe qu'après plusieurs échecs de suite, pour ne pas faire clignoter le groupe : 45 minutes sans réponse (trois vérifications) pour un fournisseur IA, hors quota (429) ; trois lectures ratées sur un quart d'heure pour Reveal CRM. Pour Reveal CRM, un 429 n'est pas une panne (c'est `pausedUntil`). `back` part au premier succès après un `down` publié.
- Publieurs : `providers` (job `providers.check_credentials` et refus à l'appel) ; `connectors` (registre Reveal CRM).

### Le rendu (Telegram)

- [ ] `down` part en `important` dans le fil `connection:<service>` : « La connexion xAI est refusée : l'agent n'écrit plus. Reconnecter la clé. » Le texte varie selon le service et la raison, et le lien ouvre Réglages › Modèles IA (ou Réglages › Ventes pour Reveal CRM).
- [ ] Une connexion toujours en panne 2 h après son alerte reçoit une seule relance en `urgent`. Le job horaire du module la lit dans son propre registre d'envois : le fil est ouvert, il n'est pas fermé, et aucune relance n'est déjà partie.
- [ ] `back` répond dans le même fil : « Rétabli : la connexion xAI fonctionne de nouveau. »
- [ ] Tests : une alerte par panne, la relance unique à 2 h, rien quand le retour arrive avant 2 h, jamais la clé.
- [ ] Le sous-titre « Important » et l'ADR 0020 § 3 nomment l'événement.

## Hors périmètre

- Une alerte quand Telegram lui-même tombe : Réglages › Telegram le montre.
- Un bot par créatrice : refusé par Charles (03/11), elle a son application.
- Les écarts de persona (ADR 0059) : contrat du fil Agent, rendu après la capture Reveal.
