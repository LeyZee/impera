# Module `fans`

**Rôle.** CRM : faits mémorisés (déclaré / déduit, source, confiance, rétention), résumé opérationnel, slots KYC.

**Peut dépendre de.** aucun module métier (feuille)

**Règles propres.** Propriétaire de `fans`, `fan_facts`, `fan_summaries`. Ne connaît pas les plateformes au-delà de `platform_account_id` ; `fans.platform_meta` garde les métadonnées brutes de la plateforme. Expose `upsertFanByPlatformId` (utilisé par `conversations.ingestMessage`, créé en P0-05), `getFan`, et la mémoire du fan (P3-02) : `proposeFacts` (n'écrit que ce qui est nouveau, un fait remplace l'ancien par `superseded_by`, un fait déduit ne remplace jamais un fait déclaré, un job rejoué n'écrit rien) et `activeFacts` (non remplacés, non expirés, triés par catégorie puis confiance, 40 au plus). La règle vit dans `domain/facts.ts` ; les notes du chatteur (`operator_note`) passent en tête et gardent jusqu'à 1 000 caractères. Les limites du fan (`fans.flags`, `FanFlagsSchema`) : `flags`, `setFlag`, `clearFlag`, avec un auteur humain ou `system` ; chaque changement réel écrit `fan_flag_set` ou `fan_flag_cleared` dans la même transaction, un appel qui ne change rien n'écrit rien. Routes (`routes(requireRole)`, montées sous `/v1`) : `GET /fans/:id/flags?creatorId=` et `PUT` du même chemin, pour le propriétaire et les chatteurs seulement (une créatrice ne voit jamais les données de ses fans, ADR 0023) avec `SetFanFlagBodySchema` ; l'auteur est l'utilisateur de la session, le serveur date la confirmation d'âge et le début d'un gel, une confirmation garde sa première date et un gel pour la même raison garde son début. Un âge contesté (`ageDisputed`) n'est reconfirmé que par le propriétaire ou un manager actif (portée `owner` | `agency` lue par `withTenantMember` dans la transaction qui verrouille le fan, `self` par défaut), avec une raison écrite gardée dans `fan_flag_set` : sinon 403 `age_dispute_forbidden` ou 400 `age_dispute_reason_invalid`, rien n'est écrit. La vue (`FanFlagsViewSchema`) dit au lecteur s'il peut le faire (`mayConfirmDisputedAge`). Un fan inconnu de cette créatrice répond 404 (`fan_not_found`). « À apprendre » (P5-01) : `GET /fans/:id/kyc?creatorId=` rend `FanKycViewSchema`, les cases du canevas que sa persona collecte (`routes(requireRole, kycSlots)`, toutes par défaut) sans fait actif de cette clé, lu sur tous ses faits actifs et non les 40 du contexte, dans son ordre (`kycToLearn`, règle `kycSlotsToLearn` dans `domain/facts.ts`) ; mêmes rôles et même 404 que les limites. Job `fans.purge_facts` (chaque jour, 3 h 45) : les faits d'un fan qu'on n'a plus vu depuis un an partent, historique compris (`security.md`).

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
