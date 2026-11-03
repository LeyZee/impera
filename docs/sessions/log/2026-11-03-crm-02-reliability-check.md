# 2026-11-03 — CRM-02 Vérification de fiabilité, mécanisme — in-progress
Fait : route propriétaire `POST /v1/settings/sales-feeds/:plateforme/check` ; lecture de l'export du dashboard (CSV) ; comparaison au centime du registre avec `/v1/stats/daily`, l'export et `/v1/stats/chatters/daily` ; notes (bot non relié à l'agent, remboursement sans vente, modèle inconnu, lignes hors des jours, statistiques indisponibles). FakeReveal calcule ses statistiques depuis son registre (`statsFromRegister`). Tests unitaires et d'intégration sur des données inventées.
Pas fait : les commissions sur `netAmount` face à l'ADR 0023 (Équipe) ; l'écran (Extension) ; le passage sur une vraie quinzaine (clé et export de Charles).
Décisions : un remboursement est retranché du jour de sa vente, comme les statistiques de Reveal ; un refus de la plateforme répond 502, un export illisible 422 ; trois vérifications par minute et par adresse, pour le quota de statistiques de l'agence ; l'adaptateur refuse des statistiques dont le fuseau n'est pas `Europe/Paris`.
Découvertes : le format réel de l'export du dashboard est inconnu ; les noms de colonnes reconnus sont une hypothèse à corriger à son arrivée.
Candidats à suppression : aucun.
Vérifié : voir la PR (pnpm check, tests unitaires `connectors`, intégration `sales-feed-check` et `sales-feed`).
