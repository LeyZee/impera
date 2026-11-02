# CRM-01 Connecter la clé Reveal et lire les ventes

Statut : todo (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : ADR 0050 fusionnée ; une clé créée par Charles pour la recette réelle seulement
Branche : task/crm-01-sales-feed
Propriétaire proposé : Bilan

## Objectif

La clé Reveal se connecte depuis les Réglages comme une clé d'IA, et Nirvana enregistre chaque vente et chaque remboursement sans doublon, sans session Reveal.

## Contexte à lire

`docs/adr/0050-reveal-two-paths-crm-api-and-captured-session.md` (§§ 2 à 4, § 9), ADR 0016, ADR 0046, `docs/reference/fake-reveal.md`, P6-01.

## À faire

- [ ] `PlatformSalesFeed` : types dans `packages/contracts`, sans aucune forme Reveal ; adaptateur dans le module `connectors`, avec capacités déclarées.
- [ ] Adaptateur API CRM : `/v1/sales` par curseur stocké, `/v1/models`, `/v1/chatters`, `/v1/stats/daily`, `/v1/stats/chatters/daily`, schémas Zod stricts, valeur inconnue passée en `other` et signalée.
- [ ] Coffre et Réglages selon l'ADR 0050 § 4 : vérifiée avant d'être gardée, écriture seule, état « à reconnecter ».
- [ ] Job rejouable : lecture du registre une fois par minute ; le curseur avance dans la même transaction que les ventes ; une vente unique sur `sale.id` et `event`.
- [ ] Registre en ajout seul, avec `inputs_hash`. Migration 0062, annoncée libre par Bilan.
- [ ] Montants en centimes entiers, par conversion décimale exacte si une conversion est nécessaire ; test `netAmount` = `agencyRevenue` + `modelRevenue`.
- [ ] `modelId` vers créatrice sous `withTenant`, quarantaine si inconnu ; correspondance `chatterId` vers membre posée par le propriétaire.
- [ ] Webhooks ensuite, dès que le support les a ouverts : signature sur le corps brut, comparaison en temps constant, horodatage refusé à ± 5 minutes, boîte de réception puis job, secret au coffre, rattrapage par curseur une fois par heure.
- [ ] FakeReveal : curseur, vente tardive, remboursement, webhook rejoué ou mal signé, `429`, `401`, `403`.

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
