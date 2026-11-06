# PROPOSED Bac à sable de recette : Reveal et IA simulés, jeu de données inventé

Statut : proposed
Phase : 3
Dépend de : P0-06 (FakeConnector), FakeReveal (P1-02 provisoire), ADR 0075 (accepted)
Branche : task/<id>-recette-sandbox

## Objectif (1 phrase)

Pouvoir jouer à l'écran, sans aucune clé ni compte réel, toute la boucle d'Impera (un fan écrit, l'agent propose, un humain envoie, une vente arrive, la paie la compte) sur une pile locale ou de recette.

## Contexte à lire

- `docs/recette/preparation-cles.md` (section « Le mode simulé ») et `docs/recette/README.md`
- `apps/api/src/composition-root.ts` (registre des connecteurs vide hors tests)
- `apps/api/src/__tests__/fake-reveal/server.ts`, `apps/api/src/__tests__/fake-reveal/crm.ts`, `docs/reference/fake-reveal.md`
- `apps/api/src/modules/connectors/infra/fake/FakeConnector.ts`, `apps/api/src/modules/connectors/infra/reveal-crm/adapter.ts` (option `baseUrl`)
- `packages/llm/src/providers.ts`, `apps/api/src/llm.ts`

## À faire

- [ ] Appliquer l'ADR 0075.
- [ ] Au démarrage en bac à sable : lancer FakeReveal, brancher un connecteur dessus, pointer l'adaptateur CRM sur FakeReveal CRM.
- [ ] Fournisseur d'IA scripté pour les rôles sens, cerveau, voix et juge, avec coût fictif et réponses piégées pour les gardes.
- [ ] Commande de jeu de données de recette, idempotente, inventée (comptes de chaque rôle, créatrices, shifts, quinzaines, fans).
- [ ] Bandeau ambre « Bac à sable : rien n'est réel » dans le CRM.
- [ ] Test : en bac à sable, aucune adresse externe n'est appelée et aucune clé réelle n'est lue.

## Critères d'acceptation

- Sur une pile neuve, une commande charge le jeu de données, et les parcours T1 à T5 et T10 à T11 de `docs/recette/parcours-transverses.md` se jouent à l'écran.
- `NODE_ENV=production` avec `IMPERA_SANDBOX=1` refuse de démarrer.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre

Le vrai `RevealApiConnector` (après la capture), la transmission de la session par l'extension, toute donnée réelle.

## Notes de session
