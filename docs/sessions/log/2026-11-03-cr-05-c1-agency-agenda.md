# 2026-11-03 — Agenda de la créatrice : l'écran de l'agence (CR-05, lot c1) — in-progress

Fait :

- Contrat : `AgencySuggestion.task` (`SuggestionFollowUp` : `when`, `doneDays`, `removed`), `null` tant qu'elle n'a pas accepté. Additif, sans migration.
- API : `GET /v1/creators/:creatorId/suggestions` lit, sous la RLS de son équipe, la tâche née de chaque suggestion acceptée et ses coches ; `doneDays` (pur, `suggestions.ts`) compte la semaine de la suggestion pour une routine, toutes les coches pour une tâche datée. Le rejeu d'un `POST` rend le même suivi.
- Écran Créatrices › Agenda (`apps/web/src/creators/agenda/`) : onglet juste après Persona, `?onglet=agenda`. « Proposer une tâche » reprend les champs de « Ajouter » (exportés de `AddDialog.tsx`), dit qu'une proposition à une heure ne tombe que dans une de ses dispos, et après l'envoi où elle est tombée. Sa semaine (‹ ›, « Cette semaine ») en trois groupes : en attente, acceptées, refusées ; chaque ligne a sa tuile de catégorie et une pastille sobre (jamais de barre de couleur sur le bord).
- `sheetsFor` (search.ts) dit les onglets de chacun : tous pour le propriétaire, Persona et Agenda pour un manager actif, Persona pour les autres ; le routeur et la page lisent la même règle.
  Pas fait : lot c2 (iCal), lot c3 (shifts de ses comptes), fiche de tournage à l'écran (attend #513).
  Décisions :
- L'agence lit d'où vient une suggestion (« Idée de l'IA ») ; elle, jamais.
- Une routine est « faite » quand tous ses jours de la semaine sont cochés, sinon « 2 sur 7 cette semaine ».
  Découvertes : le menu d'un manager (`RAILS.manager`, ADR 0024) n'a pas Créatrices, alors que l'API des suggestions lui est ouverte. L'onglet est prêt pour lui ; l'ajouter au menu est une décision de Charles. Tranché le 05/11 à 17h22 (« Ouvrir aux managers ») : le menu du manager gagne Créatrices, qui ne lui ouvre que l'agenda ; sur téléphone, Créatrices et Moi passent sous « Plus ». Le tableau de l'ADR 0024 (menu du manager) est à amender par sa procédure.
  Candidats à suppression : aucun.
  Vérifié :
- `suggestions.test.ts` (`doneDays`, 2 tests) ; `creator-agenda.integration.test.ts` (suivi d'une suggestion placée ailleurs, routine cochée puis retirée) ;
- `model.test.ts` (5 tests), `AgendaSection.test.tsx` (3 tests : liste, envoi unique sans heure, refus 409 qui garde la saisie), `CreatorsPage.test.tsx` (onglet après Persona, opérateur renvoyé à la persona) ;
- captures Nuit et Jour, ordinateur et téléphone (390 px), hors dépôt.
