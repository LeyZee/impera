# 2026-11-03 · P3-12 lot 2, côté Bilan : l'événement `connection_state_changed`

- Fiche : P3-12 (fil Telegram), partie « Le contrat (Bilan) ».
- Fait :
  - contrat `connection_state_changed` (union sur `state`, `service`, `reason`, `since`) et vocabulaire `CONNECTION_SERVICES`, `ConnectionDownReasonSchema`, `ConnectionSignal` ;
  - migration 0093 : le type dans les CHECK, index partiel `domain_events_connection_state_idx` sur (service, date) ;
  - `src/connection-state.ts` : n'écrit qu'à la bascule, sans créatrice, verrou consultatif par service ;
  - `providers` : signal après chaque écriture d'une ligne, `unreachable` après 45 minutes sans réponse, jamais sur un quota ;
  - `connectors` : clé Reveal refusée = `down` tout de suite ; `unreachable` après trois lectures ratées sur un quart d'heure ; `back` à la première lecture réussie ou à la connexion.
- Pas fait : le rendu Telegram (fil Telegram).
- Décisions : pas de raison `expired` (aucune source ne la distingue de `refused`) ; Venice n'est pas surveillé ; le compte des lectures ratées vit en mémoire du worker (un redémarrage repart de zéro).
- Découvertes : aucune.
- Vérifié : tests unitaires `providers` et `connectors`, intégration `connection-state` sur un Postgres 16 local, `pnpm drift`.
