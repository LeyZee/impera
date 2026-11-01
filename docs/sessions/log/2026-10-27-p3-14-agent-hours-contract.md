# 2026-10-27 — P3-14 Heures d'activité, contrat et relances — done
Fait :
- `packages/contracts/src/agent-hours.ts` : `AgentHoursSchema` (créneaux de réponse par jour activables, heures calmes des relances, nuit), `DEFAULT_AGENT_HOURS` (toujours ouvert, 23 h – 9 h, 22 h – 7 h), `SUGGESTED_REPLY_SLOTS` (9 h – 1 h), et les fonctions pures à l'heure de la créatrice (`Intl` seul) : `replyOpenAt`, `replyOpenedAt`, `nextReplyOpening`, `nextFollowUpAllowed`, `followUpQuietAt`, `nightAt`.
- Validation : jamais des heures calmes ou une nuit d'une journée entière (un créneau de réponse 0 h – 0 h vaut toute la journée), au moins un créneau actif en mode créneaux, aucun chevauchement entre créneaux actifs, y compris par-dessus minuit et du dimanche au lundi, chaque chevauchement signalé sur le créneau fautif (`slots[j].startMinute`) avec le nom de l'autre.
- `followUpDecision` lit les heures (motifs nouveaux `follow_up_outside_hours`, et `follow_up_no_allowed_hour` quand aucun créneau ne sort des heures calmes : aucune relance), `situation.ts` lit la nuit ; `hours` optionnel sur `AgentComposeInput`, défauts identiques à avant.
- Glossaire : heures d'activité, créneau de réponse, heures calmes des relances ; relance mise à jour.
Pas fait :
- Migration, route, worker et passage de `hours` (Bilan) ; filet « Sans réponse » muet hors créneau (Agent, après la migration) ; écran (Extension).
Décisions :
- Sans réglage, toujours ouvert : la fiche disait à la fois « défaut 9 h – 1 h » et « comportement identique sans réglage » ; tranché avec Bilan, 9 h – 1 h est la proposition de l'écran.
- `quiet` nommé `followUpQuiet` pour ne pas se confondre avec les heures calmes d'un membre (`quiet_hours`).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test.
