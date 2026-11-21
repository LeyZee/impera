# OPS-16 Chaque service d'IA prouvé et suivi : essai réel, santé, ElevenLabs dans la conso
Statut : in_progress (« ok essai IA » de Charles, 16/11/2026, 13 h 25 ; ADR 0091 § 7)
Phase : exploitation
Dépend de : OPS-08 et OPS-09 (Réglages › Consommation IA), P3-03 (Réglages › Services), ADR 0091, ADR 0016
Branche : claude/project-thread-md4sab

## Objectif
Charles voit, service par service, si Grok, Gemini, Mistral et ElevenLabs fonctionnent vraiment et s'il faut recharger : un essai réel au clic, la santé tirée du journal, et les caractères d'ElevenLabs dans Consommation IA.

## Contexte à lire
ADR 0091 (§ 7), ADR 0016, `apps/api/src/modules/providers`, `packages/llm/src/gateway.ts` (`testConnection`), `apps/api/src/modules/ai-usage`, `apps/web/src/settings/services`, `apps/web/src/settings/ai-usage`.

## À faire
- [x] Passerelle : `testConnection` journalisé sous `probe`, arrêté par le plafond, refus de clé signalé, hors de la santé de l'agent.
- [x] Migration 0221 : usage `probe`, dernier essai et mois d'ElevenLabs dans `provider_credentials`.
- [x] Module `providers` : essai réel par service (passerelle pour Grok, Gemini, Mistral ; « ok » prononcé pour ElevenLabs), un à la fois par service ; santé sur 24 h depuis `llm_calls` ; mois d'ElevenLabs lu par la vérification.
- [x] Route `POST /v1/settings/providers/:provider/probe` (propriétaire, quatre par minute).
- [x] Module `ai-usage` : usage « Essais réels », carte ElevenLabs (`voice`).
- [x] Écrans : bouton « Essai réel » et son résultat, chiffres de santé, dernière erreur, jauge du mois d'ElevenLabs ; carte ElevenLabs dans Crédits ; survols et animations.
- [ ] Relectures Bilan (passerelle, providers, migration) et Design (écrans).
- [ ] Captures Nuit et Jour, PC et téléphone, et courte vidéo, validées par Charles.

## Critères d'acceptation
- Aucun essai sans clic du propriétaire ; un essai coûte au plus un tout petit appel, compté dans la dépense et refusé au plafond.
- Un essai raté ne change pas la santé de l'agent ; une clé refusée sur l'essai passe au rouge.
- La santé ne compte que les erreurs de connexion ; la dernière erreur disparaît dès qu'un succès la suit.
- La carte ElevenLabs n'apparaît que si le service est branché ; l'offre gratuite est dite, jamais bloquée.

## Hors périmètre
Le solde exact de Grok, Mistral ou Gemini (aucune API pour une clé normale ; la clé de gestion de xAI reste non reliée) ; les vocaux eux-mêmes (PROPOSED-voice-notes).

## Notes de session
