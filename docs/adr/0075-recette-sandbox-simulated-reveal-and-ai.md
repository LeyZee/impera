# 0075. Bac à sable de recette : Reveal et IA simulés, jamais actifs hors développement

Statut : accepted (Charles, 06/11/2026 17h05, « ok, sandbox », fil « Préparer la recette complète d'Impera », en demandant un bac à sable cassable seulement en local pour essayer le branchement des clés et les connexions dans les mêmes conditions qu'en réel)
Date : 2026-11-06
Précise : l'ADR 0008 et l'ADR 0050 (les deux voies de Reveal ont chacune leur double de test), l'ADR 0009 et l'ADR 0016 (passerelle d'IA et clés posées dans le CRM), l'ADR 0027 (production).

## Contexte

La recette du 05/11 et le plan du 06/11 (`docs/recette/README.md`) montrent que la boucle centrale d'Impera (un fan écrit, l'agent propose, un humain envoie, une vente arrive, la paie la compte) ne se voit sur aucun écran tant qu'il n'y a ni clé d'IA ni connecteur Reveal. La pile de développement passe un registre de connecteurs vide (`apps/api/src/composition-root.ts`), l'adaptateur CRM appelle toujours `api.reveal.me`, et aucun fournisseur d'IA n'existe sans clé : chaque brouillon est retenu (`llm_unavailable`). Pourtant FakeReveal (`apps/api/src/__tests__/fake-reveal/server.ts`, prévu pour le développement local) et `FakeConnector` existent déjà, et ne servent qu'aux tests. Charles veut que tout soit éprouvé avant la pose des clés, pour qu'il y ait le moins de bugs possible ce jour-là.

## Décision

1. **Un interrupteur, `IMPERA_SANDBOX=1`, lu par la configuration de l'API.** Il n'est accepté que si `NODE_ENV` vaut `development` ou `test`. Avec `NODE_ENV=production`, ou sur un serveur dont `AUTH_BASE_URL` n'est pas une adresse locale, l'API et le worker **refusent de démarrer** avec une phrase claire. Le bac à sable n'est donc jamais actif hors développement : ni en recette distante sans ce réglage, ni en production.
2. **Reveal simulé.** En bac à sable, la pile lance FakeReveal, branche dans le registre un connecteur qui lui parle, et donne à l'adaptateur de l'API CRM l'adresse de FakeReveal CRM (option `baseUrl` déjà présente). Les routes de contrôle de FakeReveal (faire écrire un fan, acheter, rembourser, livrer un webhook, avancer l'horloge) servent aux agents de recette.
3. **IA simulée.** Un fournisseur à réponses scriptées tient les rôles sens, cerveau, voix et juge. Il passe par la même passerelle que les vrais (ADR 0009) : budget, journal `llm_calls` (coût fictif marqué comme tel), gardes. Il propose des réponses piégées (aveu d'IA, lien de paiement, rencontre) pour vérifier que les gardes les arrêtent.
4. **Rien de réel.** En bac à sable, aucune clé du coffre ni de l'environnement n'est lue, aucune adresse externe n'est appelée (un test le vérifie), aucune notification Telegram ou push ne part : elles restent dans la file de sortie, visibles en aperçu.
5. **On le voit.** Le CRM affiche en permanence un bandeau ambre « Bac à sable : rien n'est réel ».
6. **Jeu de données.** Une commande charge un jeu de recette inventé et idempotent (comptes de chaque rôle, créatrices, shifts, quinzaines, fans fictifs). Aucune donnée réelle (ADR 0010) ; le pourcentage de l'agence y est inventé.
7. **Mêmes conditions qu'en réel.** Le faux monde est un serveur HTTP local, lancé à part, qui imite les adresses de Reveal (API CRM et API privée provisoire de FakeReveal) et des fournisseurs d'IA (xAI, Google, Mistral, ElevenLabs). L'API garde ses vrais adaptateurs, ses vrais vérificateurs de clés et sa vraie passerelle : seule leur adresse de base change. Une clé se colle donc dans le CRM comme le jour J, est vérifiée par le même code, chiffrée dans le même coffre ; le faux monde décide, par des routes de contrôle, si elle est acceptée, refusée, sans crédit, limitée (429) ou injoignable.
8. **Le code de simulation reste hors du chemin de production** : il vit dans un dossier propre, branché par la seule racine de composition quand l'interrupteur est valide ; les règles métier, les gardes et les modules ne savent pas s'ils tournent en bac à sable.

## Conséquences

- Les parcours de l'agent et les parcours transverses (`docs/recette/parcours-transverses.md`) se jouent à l'écran avant les clés.
- FakeReveal sort du seul usage de test : ses routes provisoires seront réécrites après la capture (P1-02), et le bac à sable suivra.
- Un risque : qu'on oublie que les réponses simulées ne disent rien de la qualité de l'IA. La qualité reste mesurée par `pnpm evals` avec une vraie clé.

## Alternatives rejetées

- **Jouer seulement par les tests d'intégration** : on ne verrait jamais les écrans, ni les états intermédiaires que Charles valide en captures.
- **Des clés de test chez les fournisseurs** : coûteuses, réelles, et Reveal n'a pas de bac à sable.
- **Un interrupteur sans garde de production** : une erreur de configuration ferait parler une fausse IA à de vrais fans ; refusé.
