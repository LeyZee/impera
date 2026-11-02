# CRM-01 Connecter la clé Reveal et lire les ventes

Statut : done (lecture par curseur, PR 1 ; webhooks, PR 2 ; écran Réglages › Ventes, PR 3)
Phase : API CRM (ADR 0050)
Dépend de : ADR 0050 fusionnée ; une clé créée par Charles pour la recette réelle seulement
Branche : task/crm-01-sales-feed
Propriétaire proposé : Bilan

## Objectif

La clé Reveal se connecte depuis les Réglages comme une clé d'IA, et Nirvana enregistre chaque vente et chaque remboursement sans doublon, sans session Reveal.

## Contexte à lire

`docs/adr/0050-reveal-two-paths-crm-api-and-captured-session.md` (§§ 2 à 4, § 9), ADR 0016, ADR 0046, `docs/reference/fake-reveal.md`, P6-01.

## À faire

- [x] `PlatformSalesFeed` : types dans `packages/contracts`, sans aucune forme Reveal ; adaptateur dans le module `connectors`, avec capacités déclarées.
- [x] Adaptateur API CRM : `/v1/sales` par curseur stocké, `/v1/models`, `/v1/chatters`, `/v1/stats/daily`, `/v1/stats/chatters/daily`, schémas Zod stricts, valeur inconnue passée en `other` et signalée.
- [x] Coffre et Réglages selon l'ADR 0050 § 4 : vérifiée avant d'être gardée, écriture seule, état « à reconnecter ».
- [x] Job rejouable : lecture du registre une fois par minute ; le curseur avance dans la même transaction que les ventes ; une vente unique sur `sale.id` et `event`.
- [x] Registre en ajout seul, avec `inputs_hash`. Migration 0065 (0062 annoncée, renumérotée parce que 0064 est entrée avant : drizzle-kit lit le dernier snapshot par son nom).
- [x] Montants en centimes entiers, par conversion décimale exacte si une conversion est nécessaire ; test `netAmount` = `agencyRevenue` + `modelRevenue`.
- [x] `modelId` vers créatrice sous `withTenant`, quarantaine si inconnu ; correspondance `chatterId` vers membre posée par le propriétaire.
- [x] Webhooks ensuite, dès que le support les a ouverts : signature sur le corps brut, comparaison en temps constant, horodatage refusé à ± 5 minutes, boîte de réception puis job, secret au coffre, rattrapage par curseur une fois par heure.
- [x] FakeReveal : curseur, vente tardive, remboursement, webhook rejoué ou mal signé, `429`, `401`, `403`.

## Critères d'acceptation

- Une vente confirmée tard n'est jamais perdue (test).
- Une panne entre l'écriture et le curseur ne perd ni ne double aucune vente (test d'intégration).
- Rejouer le job ou un webhook ne crée aucun doublon (test d'intégration).
- Un `modelId` inconnu part en quarantaine et n'est compté nulle part (test).
- Une clé invalide n'est jamais gardée ; aucune route ne la renvoie (test).
- Aucun pseudo de fan dans les logs (test).

## Hors périmètre

La paie, les écrans de vente, tout appel réel sans la demande de Charles.

## Notes de session

02/11/2026, Bilan, PR 1 :
- Clé dans une table propre `sales_feed_credentials` (scellée avec `CREDENTIALS_ENCRYPTION_KEYS`, contexte `sales_feed:<plateforme>`, retirée au rôle applicatif), pas dans `provider_credentials` dont l'enum ne connaît que les services d'IA. Rechiffrement et contrôle par `ops:reencrypt-credentials` et `ops:check-keys`.
- `inputs_hash` du registre = empreinte SHA-256 de la ligne lue ; une ligne relue avec une autre empreinte lève le signal `line_changed` et ne remplace rien. Ce n'est pas l'`inputs_hash` de la paie.
- Les schémas de l'API ne sont pas `.strict()` : un champ ajouté par Reveal ne casse pas la lecture ; un champ manquant ou une valeur d'argent incohérente refuse la page et ne bouge pas le curseur.
- Modèle relié automatiquement au compte dont le pseudo est identique (sans casse) à la connexion ; sinon quarantaine jusqu'au lien posé par le propriétaire. Relier ailleurs un modèle qui a déjà des lignes est refusé (409).
- Relecture Équipe : une ligne sortie de quarantaine prend l'heure de son entrée au registre (`recorded_at`), pour que la paie la lise comme une vente tardive ; chaque lien de modèle ou de chatteur laisse une ligne `audit_log` datée (`sales_feed.model_linked`, `…_unlinked`, `sales_feed.chatter_linked`, `…_unlinked`, avec l'état d'avant). CRM-03 figera dans son `inputs_hash` le lien chatteur lu au calcul.
- Reste : écran Réglages (Extension ou une PR suivante), webhooks dans une seconde PR (migration 0067 pour la boîte de réception) quand le support les aura ouverts.

02/11/2026, Bilan, PR 2 (webhooks) :
- La livraison ne fait que réveiller la lecture par curseur : la boîte `sales_feed_deliveries` (migration 0067) garde l'id, l'événement et la position, jamais la ligne, que le job relit dans l'ordre du registre. Un seul chemin d'écriture, donc pas d'ordre à réconcilier.
- Inscription depuis les Réglages (propriétaire, connexion récente) à l'adresse `AUTH_BASE_URL` en HTTPS ; le secret est scellé comme la clé et suit la même rotation. Retirer la clé retire le webhook.
- Avec un webhook dont le secret s'ouvre, le passage de la minute ne lit qu'une fois par heure (rattrapage, ADR 0050 § 3) ; une livraison met en file `connector.read_sales` avec `woken` (une seule en attente, `job_key`).
- Rien n'est appelé chez Reveal tant que le propriétaire n'a pas inscrit le webhook, ce qui attend que le support l'ouvre.
- Reste : écran Réglages (clé, liens, bouton du webhook).

02/11/2026, Extension, PR 3 (écran) :
- Réglages › Ventes (`/reglages/ventes`, propriétaire seul) : clé, réception instantanée, liens des modèles et de l'équipe, dans `apps/web/src/settings/sales-feed/`.
- Un webhook silencieux n'alerte jamais ; `lastRejectedAt` seul propose « Réinscrire ». L'inscription part en `PUT` sans corps.
- « Confirmer » repose un lien `auto` vers le même compte : il devient celui du propriétaire avec la #413 (Bilan).
- Reste : rien pour CRM-01.
