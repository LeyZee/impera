# 2026-11-06 · CREA-01 b : la créatrice propose une correction de sa fiche

- Fiche : recette du 05/11, CREA-01, reco 2 (« lecture seule + proposer une correction », Charles, « go recos ») ; suite de #531.
- Fait : sous chaque bloc de Moi › Persona, « Proposer une correction » ouvre un champ (600 caractères) ; envoyée, la correction reste sous son bloc (« Envoyée le … · l’agence la lit », puis « Prise en compte le … » pendant 14 jours). Côté agence, au-dessus des onglets de sa persona, « Corrections proposées par … » liste celles qui attendent, chacune ouvre l’onglet de sa section ; le propriétaire la marque « Marquer traitée », un manager la lit. Table `persona_corrections` (migration 0125, RLS forcée : elle écrit et lit les siennes, le propriétaire et un manager actif les lisent, le propriétaire seul les marque traitées), routes `…/persona/corrections`, contrat `PersonaCorrection`.
- Tests : intégration `persona-corrections` (droits par rôle, idempotence, conflit, limite de 20 en attente, 404), web `MyPersonaPage` et `CorrectionsPanel`.
- Reste : rien.
- Découvertes : l’agence n’est pas prévenue d’une nouvelle correction ailleurs que sur la persona (pas de notification ni d’alerte) ; à décider avec Charles.
