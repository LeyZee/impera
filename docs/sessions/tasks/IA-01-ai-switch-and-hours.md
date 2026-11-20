# IA-01 L'IA d'une créatrice : interrupteur avec pause, heures en frise, exceptions datées, vue agence
Statut : in_progress (ADR 0148 acceptée par Charles le 19/11/2026 à 16 h 58, heure de Paris : « ok 0148 »)
Phase : 3
Dépend de : P3-14 (heures d'activité), ADR 0148, ADR 0126 § 13 et § 17, ADR 0019, ADR 0024, ADR 0149
Branche : claude/project-thread-sgx5sl (branche du fil « Activer l'IA par modèle et par shift »)

## Objectif
L'IA d'une créatrice s'allume, se coupe et se met en pause là où on la gère, et ses heures se dessinent sur une frise de la semaine, avec des exceptions datées et une vue de toute l'agence (ADR 0148).

## Contexte à lire
`docs/adr/0148-ai-switch-per-creator-and-per-slot.md`, `packages/contracts/src/agent-hours.ts`, `packages/contracts/src/dashboard.ts` (`SetAgentModeBodySchema`), `apps/api/src/modules/conversations/application/commands.ts` (`setAgentMode`), `apps/api/src/modules/conversations/application/jobs/respond.ts` (`closedUntil`), `apps/api/src/modules/persona/infra/db/creator-directory.ts` (`moveReopen`). Maquette validée : deux planches, fiche › onglet IA et Équipe › Planning (lien dans le fil).

## À faire, en lots
- [x] (a) Contrats et base (périmètre Bilan) : `until` sur `PUT /v1/agent/mode` (pause = Arrêt avec fin, une semaine au plus) et `pausedUntil` dans la réponse ; colonne `kill_switches.active_until`, lue partout comme « allumé tant que la fin n'est pas passée » ; une reprise `conversation.reopen` à la fin de la pause, sous sa propre clé ; table `agent_hour_exceptions` (FORCE RLS, fermée à la créatrice, `GRANT SELECT` au rôle de service) et routes `GET`, `PUT`, `DELETE /v1/creators/:id/agent-hours/exceptions[/:date]` (propriétaire, connexion récente pour changer, date passée refusée) ; les fonctions d'heures des contrats prennent les exceptions.
- [x] (b) Agent : `respond`, les relances, le filet « Sans réponse » et le Dashboard lisent les exceptions (`replyOpenAt`, `nextReplyOpening`, `replyOpenedAt` et `nextFollowUpAllowed` prennent les exceptions) ; une plage commencée un jour d'exception s'arrête à son minuit ; une exception écrite ou retirée déplace la reprise.
- [ ] (c) Écrans (Design) : [x] interrupteur et pause en tête de fiche et dans la liste Créatrices (`agent/AgentSwitch.tsx`, état lu dans `GET /v1/dashboard` et `/v1/dashboard/creators` : `pausedUntil`, `hoursNow`, `resumesAs`) ; [x] « Jours modifiés » dans Heures d'activité (`creators/hours/ExceptionsPanel.tsx`, dit ce qu'un jour ouvre hors de la semaine type) ; [ ] frise de l'onglet IA en section autonome (branchée dans l'onglet IA par le lot 2 de la navigation) ; jeton rose commun avec le fil Dashboard (`--nv-money-creator`).
- [ ] (d) Planning (Équipe) : l'IA et ses exceptions dans le planning ; vue « L'IA de toutes les créatrices ».

## Critères d'acceptation
- Une pause échue ne compte plus nulle part (Dashboard, Suivi, envoi, agent), sans nouvelle ligne ; les fans qui ont écrit pendant la pause reçoivent leur réponse à sa fin, à ses heures.
- Une exception remplace les plages de sa date, à l'heure de la créatrice ; une date passée ne change plus ; les dates d'une créatrice ne se lisent jamais depuis une autre.
- Doute sur l'âge, fan en difficulté et verrou de l'Automatique inchangés (ADR 0148 § 4).
- `pnpm check` et `pnpm test:all` verts ; balayages d'authentification, d'origine et d'isolation verts avec les routes nouvelles.

## Hors périmètre
Un mode par plage réglé à la main, une notification pour chaque trou (ADR 0148, alternatives rejetées).

## Notes de session
- 19/11 : lot (a) écrit. Relecture Sécurité : une pause ne lève jamais un Arrêt (Arrêt sans fin, pause plus courte, créatrice archivée : refusés, `agent_pause_conflict`). Lot (b) écrit dans la même PR. Pas de Docker dans le conteneur de la session : les tests d'intégration tournent dans la CI.
- 19/11 : lot (c), première partie : l'interrupteur (Pause 1 h / demain 9 h / sans fin, Couper confirmé, Rallumer dans le mode d'avant) et « Jours modifiés ». Reste la frise, la ligne Équipe, les chiffres et la vue agence (lot d).
