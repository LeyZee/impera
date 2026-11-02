# 2026-11-02 — CRM-01 Webhooks des ventes Reveal — in-progress
Fait : migration 0067 (`sales_feed_webhooks`, secret scellé ; boîte `sales_feed_deliveries`, retirées au rôle applicatif) ; inscription et retrait du webhook chez Reveal (`PUT`/`DELETE /v1/settings/sales-feeds/:plateforme/webhook`) ; route publique `POST /v1/webhooks/sales-feeds/:plateforme` (signature sur le corps brut, temps constant, ± 5 minutes, rejouée sans effet) qui réveille `connector.read_sales` ; rattrapage horaire quand le webhook marche ; rotation et contrôle du secret ; FakeReveal sait inscrire un webhook et forger une livraison.
Pas fait : écran Réglages ; aucun appel réel à Reveal.
Décisions : la livraison ne porte aucune vente vers la base, elle réveille la lecture par curseur ; l'adresse vient de `AUTH_BASE_URL`, en HTTPS seulement.
Découvertes : fiche ARC-04 créée à la demande du coordinateur (`checkInternals` d’eslint-plugin-boundaries, découverte de Floorplan sur la #406) ; la réponse de `POST /v1/webhooks` (201) et le corps d'une livraison ne sont pas documentés au-delà de `id`, `secret`, `event` et `data` ; le schéma lit `id` et `secret` au premier niveau ou sous `data`, à confirmer au premier appel réel.
Candidats à suppression : aucun.
Vérifié : voir la PR (pnpm check, tests unitaires et d'intégration).
