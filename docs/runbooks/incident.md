# Incident en production

## 0. Couper d'abord, comprendre ensuite

1. **Kill switch global** : dashboard → Supervision → « Tout arrêter », ou `pnpm ops:kill-switch --scope global --on --reason "<raison>"`. Effet : plus aucun appel LLM ni envoi ; le poll continue (on garde les messages entrants). La raison est gardée telle quelle en base : décris la cause (« envois en double », « ton hors persona »), ne nomme jamais un fan.
2. Si les envois seuls sont en cause : « Bloquer les envois » (le bot continue de proposer en copilote).
3. Note l'heure et l'action dans le canal d'incident (ou `docs/sessions/LOG.md`, section Incidents).

## 1. Qualifier

| Symptôme | Où regarder | Cause probable |
|---|---|---|
| Messages envoyés en double | `conversation_events` type `send_*` pour la conversation ; Graphile `jobs` | job rejoué sans idempotence (bug), ou `verifySent` qui échoue |
| Le bot dit n'importe quoi / hors persona | draft : `brief`, `policy_trace`, `guard_trace`, `persona_version_id`, `prompt_hashes` ; Langfuse trace | changement de fournisseur, persona, prompt ; garde contournée |
| Plus de réponses | `/ready`, logs worker, `platform_accounts.session_state`, `llm_calls.status` | session expirée, fournisseur LLM en panne, worker mort |
| Erreurs 429 / blocage plateforme | logs connecteur, `connector.reconcile` | rythme trop élevé, IP suspecte |
| Fuite inter-fans suspectée | drafts concernés, `guard_trace` (`cross_fan_leak`), contexte assemblé (Langfuse) | bug d'assemblage de contexte : **incident de sécurité**, voir §3 |
| Dépense LLM anormale | `llm_calls` agrégé par heure ; coupe-circuit budget | boucle de régénération, scénario de test en prod |

## 2. Corriger

- Session expirée → `session-expired.md`.
- Fournisseur LLM en panne → bascule le `fallback` du rôle en config (`CreatorSettings.llm`), redémarre le worker.
- Bug de code → revenir à la release précédente (Coolify : redéployer le SHA précédent). Les migrations sont expand/contract, un retour arrière applicatif est sûr.
- Doublons → marque les drafts fautifs `failed`, laisse la réconciliation remettre l'état en ordre ; corrige la cause avant de rallumer.

## 3. Incident de sécurité (fuite de données, accès non autorisé, secret exposé)

1. Kill switch global.
2. `rotate-secrets.md` pour tout secret potentiellement exposé.
3. Révoquer les sessions dashboard (Better Auth : `pnpm ops:revoke-sessions --all`).
4. Conserver les preuves : exporter `audit_log`, logs, événements concernés dans `.scratch/incident-<date>/` puis dans un stockage hors serveur.
5. Évaluer l'exposition : quels fans, quelles données. Charles décide des suites.

## 4. Rallumer

1. Vérifier `/ready`, un draft de test en copilote sur une conversation de test (FakeReveal ou compte de test).
2. Désactiver le kill switch par paliers : envois bloqués d'abord (copilote seul), puis envois.
3. Surveiller 30 min : `llm_calls`, `send_verified`, erreurs.

## 5. Après

Entrée dans `docs/sessions/LOG.md` (Incidents) : quoi, quand, cause, correction, ce qui empêche la récidive (test de régression, garde, alerte). Une fiche de tâche pour chaque action de prévention.
