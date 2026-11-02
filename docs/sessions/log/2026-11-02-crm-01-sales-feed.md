# 2026-11-02 — CRM-01 Connecter la clé Reveal et lire les ventes — in-progress
Fait : port `PlatformSalesFeed` et contrats (`packages/contracts/src/sales-feed.ts`, événement `sales_feed_signal`, job `connector.read_sales`) ; migration 0062 (clé scellée, curseur, liens modèle et chatteur, registre `platform_sales` en ajout seul sous RLS, quarantaine) ; adaptateur API CRM Reveal ; lecture par curseur une fois par minute, lignes et curseur dans une transaction ; routes `/v1/settings/sales-feeds…` (propriétaire, connexion récente pour la clé) ; rotation et contrôle de la clé ; faux CRM dans FakeReveal.
Pas fait : écran Réglages ; webhooks (seconde PR, migration 0065) ; aucun appel réel à Reveal.
Décisions : table propre pour la clé plutôt que `provider_credentials` (enum des services d'IA) ; `inputs_hash` = empreinte de la ligne lue ; schémas non stricts, refus de page si l'argent est incohérent.
Découvertes : `messagesSent` et `ppvSent` n'ont pas la même définition dans les deux routes de statistiques (référence `/mnt/project-files/crm-api-reference.md`) ; à trancher avant CRM-05.
Candidats à suppression : aucun.
Vérifié : voir la PR (pnpm check, tests unitaires et d'intégration).
