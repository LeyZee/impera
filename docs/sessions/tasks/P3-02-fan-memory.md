# P3-02 Mémoire par fan : coder le module `fans`

Statut : in_progress (PR 1 à 4b dans main ; reste ce qui attend la capture Reveal et le branchement des drapeaux par la politique)
Phase : 3
Dépend de : P0-03, P0-05, P0-08, P1-02 (forme des notes Reveal)
Branche : task/p3-02-fan-memory

## Objectif

Coder la mémoire par fan déjà conçue (notes client structurées) pour que l'agent connaisse chaque fan pendant des mois sans relire tout l'historique.

## Contexte à lire

`docs/architecture/data-model.md` (§ Fans et mémoire, § Conversations, § Médias), `docs/architecture/ai-engine.md` (§ Contexte, § Le Brief, § La politique), `docs/architecture/message-flow.md` (§ Mémoire, `release`), `docs/conventions/security.md` (rétention), `docs/reference/persona-schema.md` (`strategies.kyc`), `docs/reference/onlychat-analysis.md`. Besoin métier : message de Charles du 17/10 à 17h18 (fil Revue), `/mnt/project-files/chatting/methode-chatting.md` §2, §4 et §7, `/mnt/project-files/onlychat/README.md` §3 (hors dépôt).

## Ce qui est déjà conçu, et ce qui manque

| Besoin de Charles                                                                   | Déjà conçu                                                                                                                    | Manque, tranché ici                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KYC (prénom, âge, métier, ville, couple, passions…)                                 | `fans.kyc_state` (slots remplis), `fan_facts` catégorie `identity` / `life`, `kyc_missing` du brief, persona `strategies.kyc` | La liste fermée `KycSlot` : la persona ne porte plus de slots (P0-08). Ce sont les lignes du canevas de notes de Reveal, telles quelles : `first_name` (Prénom), `location` (Localisation), `age` (Âge), `job` (Métier), `hobbies` (Passions), `desires` (Envies), `situation` (Situation).                                                                                                                        |
| Faits appris                                                                        | `fan_facts` (append-only, `declared` / `inferred`, confiance, source, expiration), `fan_summaries`, `fans.refresh_summary`    | Rien.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Note libre de l'opérateur                                                           | `release(…, note)` écrit un `fan_fact` catégorie `operator_note` (`message-flow.md`)                                          | `operator_note` absent de la liste des catégories de `data-model.md` : l'ajouter.                                                                                                                                                                                                                                                                                                                                  |
| Scripts déjà envoyés                                                                | `media_sends` (un média payant n'est jamais revendu au même fan), `script_runs` réservé (phase 6)                             | Lecture « déjà envoyé à ce fan » exposée par `fans` pour le contexte ; l'écriture des `script_runs` reste en phase 6 (fiche catalogue).                                                                                                                                                                                                                                                                            |
| Achats                                                                              | `messages.is_paid`, `price_minor`, `sale_detected`, `listTransactions` du connecteur, `sales` réservé (phase 6)               | Un résumé d'achats par fan calculé (total, nombre, dernier achat, plus haut palier acheté), sans table nouvelle, pour le contexte et la politique.                                                                                                                                                                                                                                                                 |
| Phase de la relation (KYC, sexualisé, client), ce qui l'excite, ce qu'il n'aime pas | `fan_facts` catégories `preferences`, `intimate`                                                                              | `relationship_phase` calculée par le code (`kyc` → `sexualized` → `client`, depuis les faits, l'âge confirmé et les ventes), jamais par le LLM.                                                                                                                                                                                                                                                                    |
| Étapes refusées et raison du refus                                                  | `offer_made`, `sale_detected`                                                                                                 | Fait `commercial` « refus » relié à l'offre (`offer_id`, raison si connue), lu avant de relancer.                                                                                                                                                                                                                                                                                                                  |
| Limites du fan                                                                      | `fans.flags` (jsonb, non spécifié), risques du brief (`distress`, `minor_suspected`…)                                         | Clés fermées de `fans.flags`, lues par la politique avant toute offre : `age_confirmed` (date), `sales_frozen` (raison : `money_trouble`, `spending_limit`, `distress`, `operator`), `spending_limit_minor`, `fragile`, `no_explicit`, `do_not_contact`. `sales_frozen` et `fragile` bloquent aussi le chouinage (méthode §4). Écrites par la politique (risque détecté) ou par un humain, jamais par le LLM seul. |

## Les notes de Reveal (Charles, 17/10 à 17h33 ; observées par le fil Connexion Reveal)

Reveal tient déjà la fiche du fan, dans le panneau de droite de chaque conversation (inventaire du connecteur Reveal, section « Observé à l'écran », PR #15, pas encore fusionnée) :

- **Notes** : texte libre structuré par le canevas de l'agence, Prénom, Localisation, Âge, Métier, Passions, Envies, Situation. L'agent le remplit ligne par ligne sans en changer le format : c'est la note que l'agent et les humains lisent.
- **Prénom du membre** : champ dédié, source de la variable `%NAME%` des scripts. Premier slot à remplir ; garde en code : jamais de `%NAME%` brut ni de prénom vide.
- **Note du modèle** : la fiche de la créatrice, réécrite depuis la persona active. Données personnelles : jamais dans le dépôt ni dans un log (ADR 0010).
- **Analytics** : total dépensé, tips, messages, dernier paiement, achat le plus élevé, abonnement. Lus pour `purchaseSummary`, pas recopiés.

Ce que Nirvana ajoute, et seulement cela, parce que Reveal ne le stocke pas : les faits datés et leur historique (`fan_facts`), ce qui a été vendu ou refusé et pourquoi (`media_sends`, ventes, faits « refus »), les scripts déjà envoyés (Reveal n'a pas d'indicateur « déjà envoyé »), la phase de la relation et les drapeaux de sécurité.

- **Lecture** : à l'ingestion, chaque ligne du canevas devient le fait de son slot (`source: platform_note`) ; le prénom du membre aussi.
- **Écriture** : un fait confirmé d'un slot réécrit sa ligne du canevas ; un humain qui modifie une ligne dans Reveal l'emporte sur le fait plus ancien, remplacé (`superseded_by`).
- **Point d'accroche** : capacités optionnelles du port connecteur (`readFanNotes`, `writeFanNotes`, `readFanStats`, signalées dans `ConnectorCapabilities`). La forme des appels vient du trafic (P1-02) ; sans ces capacités, la mémoire fonctionne seule.

## À faire

- `packages/contracts` : `KycSlot`, `FactCategory` avec `operator_note`, `FanFlagsSchema` (clés ci-dessus), `FanPurchaseSummary`.
- Module `fans` (domain, application, infra, `index.ts`) : `proposeFacts(fanId, facts, evidence)` (append-only, remplace par `superseded_by`), `activeFacts(fanId)` (non remplacés, non expirés, triés catégorie puis confiance, 40 au plus), `kycState(fanId)`, `setFlag` / `clearFlag` (événement `domain_events`, auteur obligatoire), `purchaseSummary(fanId)`, `sentMediaIds(fanId)`.
- `assembleContext` lit `activeFacts`, le dernier `fan_summary`, `kycState`, `purchaseSummary` et les drapeaux. Les faits d'un fan n'entrent jamais dans le contexte d'un autre (garde « fuite d'un autre fan »).
- Écriture : les `facts_proposed` du brief deviennent des faits ; en copilote, l'approbation du draft les confirme (`fact_confirmed`).
- Politique : un drapeau `sales_frozen` ou `do_not_contact`, ou un âge non confirmé avant du contenu explicite, interdit l'offre (`policy_trace`) ; `sales_frozen` ou `fragile` interdit le chouinage ; suivre un fan qui sexualise demande `persona.strategies.kyc.min_hours_before_following` atteint et l'âge confirmé.
- Rétention : job de purge des faits expirés (12 mois après le dernier contact, `security.md`).
- Docs : `data-model.md` (catégories, clés de `flags`), glossaire (« Drapeau du fan » : `fan_flag`).

## Critères d'acceptation

- Tests unitaires du domaine : remplacement d'un fait (Lyon en mai, Paris en août), expiration, tri et plafond de 40, calcul d'âge confirmé, résumé d'achats.
- Tests d'intégration (Testcontainers) : RLS, un fan ne voit jamais les faits d'un autre ni d'une autre créatrice.
- Évals : fan à découvert, fan qui fixe une limite de dépense, fan de 18 ans, fan qui revient après trois semaines (il est reconnu).

## Hors périmètre

Tables `scripts`, `bundles`, `sales` (fiche catalogue), la forme exacte des notes et statistiques Reveal (P1-02), interface de la fiche fan dans l'extension, import de l'historique Reveal.

## Notes de session

- 2026-10-23 (agent) : découpage en quatre PR, sans la capture Reveal. 1) module `fans` : `proposeFacts`, `activeFacts`, règle pure `domain/facts.ts`, tests unitaires et Testcontainers (fait). 2) contracts : `KycSlot`, `operator_note`, `FanFlagsSchema`, migration du check de catégorie si besoin (accord et migration de Bilan). 3) `conversations` : les `factsProposed` du brief deviennent des faits, `fanContext` lit `activeFacts` (Bilan). 4) drapeaux lus par la politique, purge à 12 mois du dernier contact. Attend la capture : notes et statistiques Reveal (`readFanNotes`, `purchaseSummary`).
- 2026-10-23 (agent) : PR 1 fusionnée (#134). PR 2 : `KycSlotSchema` et `KYC_SLOT_LABELS`, `FanFlagsSchema` (clés jsonb en camelCase, convention du dépôt, au lieu des noms snake_case de cette fiche). `operator_note` attend la migration 0014 de Bilan, avec `release(…, note)` (PR 3).
- 2026-10-23 (agent) : PR 2 fusionnée (#135). PR 4a : `offerDecision` et `maySulk` lisent les drapeaux. Restent : lire et écrire `fans.flags` dans le module `fans` avec l'événement de son auteur (type d'événement dans contracts, Bilan), la purge à 12 mois du dernier contact (job et tâche, Bilan), et le plafond de dépense, qui attend le prix des scripts (P6-01).
- 2026-10-23 (agent) : PR 4a fusionnée (#136). PR 4b : purge `fans.purge_facts`, 12 mois après `fans.last_seen_at`. Les drapeaux (lire, poser, lever avec l'auteur) attendent un type d'événement, donc la migration 0015 de Bilan (le check de `domain_events.type` suit `EVENT_TYPES`). Les résumés (`fan_summaries`) ne sont pas encore purgés : rien ne les écrit.
- 2026-10-23 (agent) : PR 3 (#138, Bilan) et 4b (#137) fusionnées. PR 4c : `flags`, `setFlag`, `clearFlag` dans `fans` (événements `fan_flag_set` / `fan_flag_cleared` de la 0014) ; notes du chatteur gardées jusqu'à 1 000 caractères et placées avant les autres faits. Reste : qui pose les drapeaux (la politique sur un risque, un écran pour l'humain), l'âge confirmé, et les notes et statistiques Reveal après la capture.
- 2026-10-23 (agent) : PR 4c fusionnée. PR 5 : routes `GET` et `PUT /v1/fans/:id/flags` pour l'humain (contrat `FanFlagsViewSchema`, `SetFanFlagBodySchema`), l'auteur est la session ; Extension branche l'écran. Reste : la politique pose elle-même un drapeau sur un risque des gardes (PR 6), les notes et statistiques Reveal après la capture.
- 2026-10-23 (agent) : PR 5 fusionnée (#142). PR 6 : le composeur lit les drapeaux avant tout appel (« ne plus écrire » → un chatteur) et, sur une passation due à un risque, pose « ne plus écrire » (détresse, menace) ou retire l'âge confirmé (mineur présumé), auteur `system`. Reste : les notes et statistiques Reveal après la capture, l'écran des drapeaux (Extension).
