# P3-14 Heures d'activité de l'agent, par créatrice
Statut : done (ID validé par Charles le 27/10 à 20h37, carte « Les 5 sans capture, désir en tête »)
Phase : 3
Dépend de : P3-10 (relances, heures calmes), P3-11 (réponse différée, filet « Sans réponse »), EQ-02 (planning, hybride), ADR 0025
Branche : task/P3-14-agent-hours

## Objectif
Charles règle, créatrice par créatrice, les créneaux pendant lesquels l'agent peut répondre ; hors créneau l'agent se tait, garde les messages et y répond à la reprise. Les heures calmes des relances deviennent un réglage de la même page.

## Contexte à lire
`apps/api/src/modules/agent/domain/follow-up.ts` (heures calmes 23 h – 9 h en dur), `situation.ts` (Jour / Nuit 22 h – 7 h en dur), `apps/api/src/modules/conversations/domain/rules.ts` (`debounceFor`, `deferredRespondAt` borné à 5 – 25 min depuis #214), le filet « Sans réponse » de 30 min (#215), EQ-02 et `apps/web/src/scheduling/` (grille et mots du planning), ADR 0025, `docs/reference/desirely-analysis.md` (§ Horaires).

## Ce que fait Desirely
Onglet Horaires par modèle : fuseau d'abord, mode 24/7 par défaut ou créneaux jour par jour (ex. lundi 9 h – 23 h), chaque créneau activable sans être supprimé. Hors créneau, ni réponse ni relance ; les messages reçus sont repris à la reprise. Raison donnée : une créatrice qui répond tous les jours à 4 h du matin éveille les soupçons, et des plages restent aux humains.

## Règles
- **Deux réglages, un seul endroit.** Les créneaux de réponse (défaut 9 h – 1 h tous les jours, pas 24/7) et les heures calmes des relances (défaut 23 h – 9 h, la valeur actuelle) vivent ensemble dans `AgentHours`, à l'heure de la créatrice. Ils remplacent les constantes de `follow-up.ts`.
- **Répondre et relancer ne se règlent pas pareil.** Un fan qui écrit à minuit dans un créneau ouvert reçoit sa réponse ; personne ne reçoit une relance non sollicitée pendant les heures calmes, même si le créneau de réponse est ouvert. Une relance tombée hors créneau ou en heures calmes part à la première minute où les deux le permettent.
- **La bascule Jour / Nuit** du catalogue (22 h – 7 h, `situation.ts`) devient un réglage lu au même endroit, sans changer de sens.
- **Hors créneau, la conversation se repose.** Le `retryAt` de `respond` ne convient pas : `deferredRespondAt` le borne à 25 min et ignore un délai plus long. Il faut un mécanisme côté worker (Bilan) : aucun brouillon n'est fait, et une reprise est programmée à l'ouverture du créneau suivant ; à la reprise, l'agent répond aux fans qui ont écrit, le plus ancien d'abord, dans le plafond du jour.
- **Le filet « Sans réponse »** de 30 min (#215) se tait hors créneau ; il reprend son compte à l'ouverture, sinon toutes les conversations reçues la nuit y tomberaient.
- **Hybride** : un chatteur en poste n'est pas borné par ces heures et répond dans Reveal ; l'agent, lui, ne répond que dans son créneau, chatteur en poste ou non (ADR 0025, décidé en relecture de #232). Ce que l'agent fait quand un chatteur est en poste relève d'EQ-08.

## À faire
- [x] Contrat `AgentHours` (fuseau de la créatrice, créneaux de réponse par jour activables, heures calmes des relances, bascule Jour / Nuit) ; stockage en colonne jsonb validée par Zod sur `creators`, sans nouvelle table (Bilan attribue la migration).
- [x] `follow-up.ts` et `situation.ts` lisent `AgentHours` au lieu de leurs constantes ; les valeurs par défaut reproduisent le comportement actuel.
- [x] Politique côté worker (Bilan) : hors créneau, pas de brouillon, chatteur en poste ou non ; `reply_deferred` et un job `conversation.reopen` par créatrice à l'ouverture, qui répond aux fans en attente, l'attente la plus longue d'abord ; colonne `creators.agent_hours` (migration 0024) ; route `GET`/`PUT /v1/creators/:id/agent-hours` (propriétaire, connexion récente pour changer) ; `hours` passé au moteur par `ComposeInput`.
- [x] Filet « Sans réponse » muet hors créneau, déclenché 30 min après `replyOpenedAt` ; l'attente affichée reste comptée depuis le message du fan (Agent).
- [x] Écran (Extension), dans Créatrices, réservé au propriétaire (onglet et adresse, leçon de #217) : la grille et les mots du planning EQ-02 (« 9 h – 1 h » avec espaces insécables, « jusqu'au lendemain »), un en-tête qui dit le fuseau lu (« À l'heure de Nora (Paris) », car le planning se lit à l'heure de l'agence et ces heures à celle de la créatrice), un créneau désactivé grisé en encre pâle, jamais rouge.

## Critères d'acceptation
- Tests : message reçu à 3 h, réponse à l'ouverture ; message reçu à minuit dans un créneau ouvert, réponse immédiate mais aucune relance avant 9 h ; changement d'heure ; créneau désactivé ; changement des heures qui déplace l'ouverture ; filet « Sans réponse » muet la nuit ; sans réglage, comportement identique à aujourd'hui.
- Écran : Nuit et Jour, 1 440 et 400 px, mouvement réduit, état « Le serveur ne répond pas ».

## Hors périmètre
Le planning des chatteurs (EQ-02).

## Notes de session
- 27/10 (Agent, PR 1) : contrat `packages/contracts/src/agent-hours.ts` (schémas, défauts, `replyOpenAt`, `replyOpenedAt`, `nextReplyOpening`, `nextFollowUpAllowed`, `followUpQuietAt`, `nightAt`), relances et Jour / Nuit branchés, `hours` optionnel sur `AgentComposeInput`. Décidé avec Bilan : sans réglage = toujours ouvert (le comportement d'aujourd'hui) ; 9 h – 1 h n'est que la proposition de l'écran (`SUGGESTED_REPLY_SLOTS`).
- Reste : migration 0024 `creators.agent_hours`, route propriétaire, worker (pas de brouillon hors créneau, reprise à l'ouverture, le plus ancien d'abord), `hours` passé par ComposeInput et FollowUpContext (Bilan) ; filet « Sans réponse » muet hors créneau, compté depuis `replyOpenedAt` (Agent, après la migration) ; écran (Extension).
- 27/10 (Bilan, PR 2, #232) : migration 0024 (`creators.agent_hours`, jsonb objet ou null), route propriétaire (`invalidStored` quand le réglage stocké ne se lit plus), worker. Hors créneau : `reply_deferred` (raison `outside_hours`, `until`), conversation laissée `pending`, un seul `conversation.reopen` par créatrice à l'ouverture, qui remet `conversation.respond` en file pour chaque conversation `pending`, une toutes les 15 s, sans écourter un debounce en cours. Un `PUT` des heures déplace ce job à la nouvelle ouverture. Une attente choisie (P3-11) garde son propre job avec `waitedFor`. Une relance repoussée peut aller jusqu'à 8 jours. Décidé en relecture avec Agent : un chatteur en poste ne rouvre pas l'agent hors créneau, puisqu'il répond dans Reveal (ADR 0025).
- 27/10 (Agent, PR 3) : filet « Sans réponse » branché sur les heures. `unansweredSince` (supervision) : rien hors créneau, et à l'ouverture le compte de 30 min part de `replyOpenedAt`, pas du message du fan ; le lecteur du Dashboard lit `creators.agent_hours` (illisible ou absent = défauts, toujours ouvert). Reste : l'écran (Extension).
- 27/10 (Extension, PR 4) : écran Créatrices › Heures d'activité (`apps/web/src/creators/hours/`), onglet « Persona · Heures d'activité » et adresse `/creatrices?onglet=heures`, propriétaire seul (un autre rôle est renvoyé sur `/creatrices`). La semaine se lit à l'heure de la créatrice, avec ses créneaux, la part d'après minuit d'un créneau de nuit sur le jour suivant et ses heures calmes hachurées. Chaque ligne porte l'erreur du contrat qui la concerne (chevauchement, plage vide), et Enregistrer reste fermé tant qu'une ligne est à corriger. L'avertissement ambre « Aucune relance ne pourra partir » ne bloque pas. Revenir aux réglages d'origine enregistre `null`, et un réglage stocké illisible (`invalidStored`) est dit puis remplacé à l'enregistrement. Une connexion trop ancienne fait demander le mot de passe, puis l'enregistrement repart. Dans Suivi, `reply_deferred` devient une note « Hors de ses heures : la réponse attend l'ouverture de son créneau, demain à 9 h », une seule par ouverture.
