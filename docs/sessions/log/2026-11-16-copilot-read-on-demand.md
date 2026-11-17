# 2026-11-16 — Copilote : lire à la demande une conversation jamais relevée

- **Tâche** : recette du 16/11, Bilan (copilote « Impera n'a pas encore lu cette conversation »).
- **Fait** : le panneau du copilote qui ne trouve pas la conversation ouverte met en file `connector.read_conversation` sur les comptes lisibles des créatrices candidates de cette plateforme, au plus une fois par minute et par conversation. Le job lit la conversation par son id (`getConversation`, `GET /conversations/:id`) et l'ingère comme un relevé (20 derniers messages ; un message de plus de 6 h est rattrapé, pas répondu). `not_found` (conversation d'un autre compte) s'arrête sans bruit ; les autres échecs sont journalisés sans nourrir le coupe-circuit. Le rattrapage (`connector.reconcile`) passe sa fenêtre de 24 h à la plateforme au lieu de lire toute la liste puis de filtrer.
- **Cause** : le premier relevé d'un compte ne lit que les conversations actives depuis 24 h ; une conversation calme avant n'entrait dans aucune liste lue.
- **Tests** : `read-conversation.test.ts` (nouveau), `connector.test.ts` (Reveal, `getConversation` contre FakeReveal), `copilot.integration.test.ts` (mise en file, une seule fois, sur la file du compte).
- **Découvertes** : aucune.
- **Reste** : rien sur ce lot.
