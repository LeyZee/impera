# P6-02 Après une offre : refus, achat, aide au paiement, relances de vente

Statut : todo (ID validé par Charles le 27/10 à 19h56)
Phase : 6
Dépend de : P6-01 (historique des scripts, des offres et des ventes Reveal), P3-10
Branche : task/P6-02-after-offer

## Objectif

Appliquer en code ce que la méthode de chatting (document hors dépôt, tenu par Charles) demande autour d'une offre, une fois que Nirvana sait quelle offre est partie, laquelle a été refusée et laquelle a été achetée. Les règles sont reformulées ici, aucune phrase du document n'est recopiée (ADR 0010).

## Contexte à lire

- `PROPOSED-method-gaps.md` (état au 27/10 soir), `P6-01-sales-catalog.md`, `P3-10-follow-ups.md`
- `apps/api/src/modules/agent/domain/policy.ts` (`offerDecision`, `maySulk`, `offerSignals`), `follow-up.ts`, `hold.ts`
- `apps/api/src/modules/agent/infra/compose.ts`, `draft-composer.ts`
- `packages/contracts/src/persona.ts` (`strategies.post_offer`, `strategies.script_launch`)

## Règles à porter

1. **Rythme des offres** : le délai entre deux scripts (`script_launch.cooldown_hours`, 10 h par défaut) et la re-sexualisation, qui remplacent les compteurs « offres par jour » et « offres sans achat » (décision de Charles, 17/10 à 22h00). Ici, on branche seulement `lastOfferAt` sur l'historique de P6-01.
2. **Après un refus**, dans l'ordre : demander ce qui ne lui a pas plu, insister un peu, bouder une fois au plus (`maySulk`), puis lâcher. La bouderie commence joueuse ; jamais juste après un achat, jamais avec un fan qui a parlé d'argent, de ses limites, de détresse, ni avec un fan fragile ou gelé.
3. **Après un achat** : attention et tendresse à chaque fois (aftercare), sans en faire trop ; pas de nouvelle offre ni de bouderie juste après.
4. **Aide au paiement** : quand il bloque sur le moyen de payer, un message d'aide fixe (ce que contient le pack, son prix, comment l'ouvrir), puis un humain si ça bloque encore. Une question sur le fait de devoir payer est un signal d'achat : elle reçoit une réponse franche.
5. **Relances de vente** : après une offre refusée ou restée sans réponse, au plus deux relances de vente, au délai de `post_offer.delay_days` ; aucune pour un fan gelé, fragile ou en détresse. Elles passent par `conversation.follow_up` et par `offerDecision`.

## À faire

- [ ] Politique : `lastOfferAt` branché sur l'historique de P6-01 ; `refusalStep` (comprendre, insister, bouder, lâcher) ; `afterPurchase` ; `salesFollowUpDecision`. Tout en règles pures testées.
- [ ] Composeur : brief fixé par le code à chaque étape (refus, aftercare, aide au paiement), comme le recadrage et les relances.
- [ ] Évals : fan qui refuse, fan qui achète, fan qui ne sait pas payer, fan qui demande s'il doit payer.

## Critères d'acceptation

- Tests du domaine : une seule bouderie par refus, jamais de bouderie ni d'offre juste après un achat, deux relances de vente au plus, aucune pour un fan gelé.
- `pnpm check`, `pnpm test`, `pnpm test:integration` verts.

## Hors périmètre

Le catalogue et la synchronisation des scripts (P6-01), les textes de vente propres à Messa, tout envoi réel.

## Notes de session

27/10 : proposée par le fil agent après la passe méthode / code sur main 5a3e09d.

27/10 19h56 : ID P6-02 donné par Charles. En numérotant, retiré les deux compteurs d'offres que la fiche réintroduisait : Charles les a remplacés le 17/10 à 22h00 par le délai entre scripts et la re-sexualisation (journal `2026-10-17-sales-policy.md`).
