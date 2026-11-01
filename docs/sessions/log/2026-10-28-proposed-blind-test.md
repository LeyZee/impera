# 2026-10-28 — Fiche proposée : test à l'aveugle avant l'Automatique (Agent) — done
Fait : `docs/sessions/tasks/PROPOSED-blind-test.md` (protocole, masquage, seuil, rangement, ce que ça demande à Bilan, Agent et Extension, estimation, trois questions à Charles avec défauts). Aucun code.
Pas fait : tout le code, en attente de l'ID de Charles.
Découvertes : le test à l'aveugle s'enregistre aujourd'hui par un taux tapé à la main (`POST /v1/creators/:id/blind-tests { rate }`) ; rien ne relie ce taux à une séance réelle.
Candidats à suppression : aucun.
Relecture Telegram : réponse humaine sans brouillon (`send.ts:121` écrit `human` pour un brouillon retouché), rejeu à la date de la situation, noms masqués dans les réponses, définition de la réponse humaine, rétention et outbox, exception à l'ADR 0023 ; ADR 0034 proposée (numéro réservé par le coordinateur).
Après les maquettes d'Extension : états `preparing` et raison d'abandon (`version_changed`, `cancelled`, aussi dans l'ADR 0034 proposée), situations jugées dans les 30 derniers jours écartées du tirage, plus de carte transformée en cas d'éval (vrai texte de fan, ADR 0010).
