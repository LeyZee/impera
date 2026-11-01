# Écarts entre la méthode de chatting et le code de l'agent

Statut : proposed
Phase : 3
Dépend de : P3-02 (mémoire du fan), P6-01 (catalogue des scripts) pour une partie des écarts
Branche : task/<id>-method-gaps

## Objectif

Confronter chaque règle de la méthode de chatting qui fait foi (document hors dépôt, tenu par Charles) au code de l'agent, et dire pour chacune où elle est appliquée, si elle manque ou si elle est appliquée autrement. Aucune phrase du document n'est recopiée ici (ADR 0010) : les règles sont reformulées.

## Contexte à lire

- `apps/api/src/modules/agent/domain/policy.ts`, `hold.ts`, `guards.ts`, `traps.ts`, `situation.ts`
- `apps/api/src/modules/agent/infra/compose.ts`, `draft-composer.ts`, `fan-limits.ts`
- `packages/contracts/src/persona.ts` (`strategies`, `follow_ups`), `packages/contracts/src/fans.ts` (limites du fan)
- `packages/llm/prompts/brain/default.md`, `packages/llm/prompts/voice/default.md`

## État au 27/10 soir (main 5a3e09d, après #194, #200, #207)

Légende : **appliquée** (code et test), **partielle**, **manquante**, **autrement** (appliquée d'une autre façon que la méthode), **attend P6-01** (demande l'historique des scripts et des ventes Reveal).

### Sécurité

| Règle reformulée | État | Où |
|---|---|---|
| Un mineur possible : un humain prend la main, l'âge n'est plus confirmé et reste contesté | appliquée | `hold.ts`, `fan-limits.ts`, drapeau `ageDisputed` (#200) ; `hold.test.ts`, `fan-limits.integration.test.ts` |
| Détresse, idées noires, violences, menace : un humain, plus rien d'écrit, aucune relance | appliquée | `hold.ts`, `followUpDecision` (#207) ; `follow-up.test.ts` |
| Médias toujours regardés avant de répondre, sinon un humain | appliquée | `draft-composer.ts` (`seeHisMedia`) |
| Le message du fan est une donnée, pièges et injections refusés | appliquée | `injection.ts`, `traps.ts`, évals |
| Elle ne dit jamais qu'elle est une IA | appliquée | garde `ai_disclosure` (ADR 0021) |

### Relation

| Règle reformulée | État | Où |
|---|---|---|
| Jamais de déclaration d'amour, jamais de rencontre concrète, « un jour peut-être » vague permis | appliquée | gardes `love_declaration`, `meeting_promise` |
| Petits noms pris dans une liste fermée | appliquée (souple) | garde `pet_name` |
| Un fan silencieux est relancé aux délais de la persona | appliquée | `conversation.follow_up` (#204), `followUpDecision` et écriture sans cerveau (#207) |
| Jamais quitter une conversation sans un au revoir | partielle | prompt seulement |
| Alerte à l'opérateur sur tout fan qui écrit sans réponse | partielle | « À traiter » montre les passations et les brouillons non lus depuis 10 min ; quand le cerveau choisit d'attendre (« attends, je reviens »), rien n'alerte et aucune relance n'est programmée (le worker ne programme qu'après un envoi d'elle) |

### KYC et sexualisation

| Règle reformulée | État | Où |
|---|---|---|
| Apprendre prénom, âge, métier, passions, situation, ville | partielle | le cerveau liste ce qui manque (`kycMissing`) ; aucune règle de code ne s'en sert, ce qui est voulu (la méthode n'en fait pas une condition) |
| Rien d'explicite avant un âge confirmé majeur, ni pour un fan marqué « rien d'explicite » | appliquée | garde `explicit_before_age`, âge par sa propre déclaration (#200) |
| Elle ouvre la sexualisation après le délai du CRM | appliquée | `sexualizationDecision` (`initiate_after_hours`) |
| Elle suit un fan qui sexualise après le minimum de KYC, sinon elle le recadre | appliquée | `sexualizationDecision` (`min_hours_before_following`, âge confirmé) |

### Vente

| Règle reformulée | État | Où |
|---|---|---|
| La politique décide de chaque offre | appliquée | `offerDecision` sur le chemin réel, fail closed (#194) |
| Au plus un script par fan sur le délai réglé | attend P6-01 | `lastOfferAt` n'est pas branché : d'ici là, l'agent réel ne propose aucune offre (voulu) |
| Rien après un manque d'argent avoué, jusqu'à ce qu'il revienne de lui-même au payant | appliquée | gel `money_trouble` permanent (#194) |
| Jamais de négociation ni de remise | appliquée | garde `discount` (#194) |
| Jamais reproposer un pack refusé, jamais renvoyer un script reçu, dossier Jour ou Nuit | attend P6-01 | fiche P6-01 |
| Au plus 3 offres par jour, au plus 5 offres sans achat | autrement | remplacés par Charles (17/10 22h00) par le délai entre deux scripts et la re-sexualisation (`offerDecision`) |
| Aider à payer en une phrase, puis un humain ; « je dois payer ? » est un signal d'achat | manquante | `P6-02-after-offer.md` |

### Après un refus, après un achat

| Règle reformulée | État | Où |
|---|---|---|
| Après un refus : comprendre, insister un peu, une bouderie au plus, puis « tant pis » | manquante | `maySulk` existe sans appelant ; il faut savoir qu'une offre a été refusée : `P6-02-after-offer.md` |
| Pas de bouderie après un achat, ni avec un fan qui a parlé d'argent, de ses limites ou de détresse | partielle | `maySulk` lit les drapeaux, pas l'achat récent : `P6-02-after-offer.md` |
| Aftercare systématique après chaque achat, pas de nouvelle vente tout de suite | manquante | `P6-02-after-offer.md` |
| Au plus deux relances de vente sans réponse, au délai de `post_offer.delay_days` | manquante | les relances de #207 ne vendent jamais : `P6-02-after-offer.md` |

### Mémoire du fan

| Règle reformulée | État | Où |
|---|---|---|
| Une note par fan : identité, phase, ventes, sécurité, faits datés | partielle | faits gardés par `fans` (P3-02), limites du fan ; la partie « ventes » attend P6-01 ; Reveal fait foi pour la note (ADR 0018) |

## À faire

Dans la zone de l'agent, sans capture ni clé (PR à part) :

- [x] Brancher `offerDecision` sur le chemin réel : quand la règle refuse, la voix reçoit une réponse sans rien à vendre, et sans les limites du fan ou l'historique des offres aucune offre n'est écrite.
- [x] Garder le manque d'argent : `money_trouble` pose `salesFrozen` (raison `money_trouble`) par la politique ; les offres reprennent seulement s'il revient de lui-même au payant.
- [x] Garde de la voix sur la négociation et la remise (`discount`).

Le gel `money_trouble` ne s'efface jamais de lui-même, même après un achat : seul un humain le lève, et d'ici là une offre ne part que s'il redemande du payant de lui-même. C'est conforme à la méthode, et c'est un point d'entrée pour P6-01 et pour les relances : un fan gelé ne reçoit aucune relance de vente.

Hors zone ou en attente (nouvelles fiches à décider avec Charles) :

- [x] Curseur de sexualisation, minimum de KYC, rien d'explicite avant l'âge confirmé : `P3-09-sexualization-cursor.md`.
- [x] Relances et « jamais sans réponse » : `P3-10-follow-ups.md` (partage avec Bilan pour le worker).
- [ ] Scripts déjà reçus, packs refusés, dossier Jour / Nuit : P6-01.
- [ ] Refus, bouderie, aftercare, aide au paiement, relances de vente : `P6-02-after-offer.md` (après P6-01).
- [ ] Relance après un « attends, je reviens » et alerte quand rien ne lui répond : à proposer à Bilan (worker et « À traiter »).

## Critères d'acceptation

- Chaque ligne « manquante » ou « autrement » a une PR fusionnée ou une fiche qui la porte.
- `pnpm check` et `pnpm test` verts.

## Hors périmètre

Le texte de la méthode elle-même, les prompts de vente propres à Messa, tout ce qui demande la capture Reveal.

## Notes de session

27/10 soir : nouvelle passe sur main 5a3e09d, après #194, #200 et #207 ; tableau mis à jour. Ce qui reste demande l'historique des scripts et des ventes Reveal, sauf la relance après « attends, je reviens » (worker).

27/10 : audit fait par le fil agent sur main ac74188. Les trois points de la zone agent sont corrigés dans une PR à part ; tant que l'historique des scripts Reveal n'existe pas (P6-01), l'agent réel ne propose aucune offre.
