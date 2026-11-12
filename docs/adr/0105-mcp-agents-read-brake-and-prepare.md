# 0105. Le MCP d'Impera remis à jour : un agent connecté lit, freine et prépare, un humain confirme

Statut : accepted (Charles, 13/11/2026, 0 h 38, « ok 0105 » ; demande de Charles du 12/11/2026, fil « Mettre à jour le MCP du CRM » : « il faudrait le mettre à jour, le MCP, parce que le CRM a pas mal bougé » ; choix « Lire, freiner, préparer » sur la carte de décision du 12/11/2026, 23 h 35 ; numéro 0105 attribué par le coordinateur). **Amende l'ADR 0026, acceptée** (§ 2 à § 5, § 7 et § 9) ; ne touche pas l'ADR 0058.
Date : 2026-11-12

## Contexte

L'ADR 0026 (27/10) a fixé le serveur MCP : une seconde porte sur les mêmes commandes que l'écran, un jeton par agent, la règle « freiner, jamais accélérer ». Rien n'en est codé au 12/11 : ni module `mcp`, ni route `/v1/mcp`. Entre-temps le CRM a changé sous elle :

- Nirvana s'appelle Impera (ADR 0062).
- Tout compte a un second facteur obligatoire (ADR 0046), les gestes sensibles demandent le mot de passe et un code de moins de 10 minutes, ou un geste de passkey (ADR 0046 § 3, ADR 0053 § 4).
- Des écrans sont nés que le catalogue de 0026 ignore : la fiche du fan remplie par l'IA (0085), le Bilan de la quinzaine (0084), les ventes relevées (0073, 0078), les relevés quotidiens de la plateforme (0081), la consommation IA (0091), les dépôts de médias et les scripts (0083), l'équipe importée de la plateforme (0076).
- La base a un rôle de service distinct du propriétaire (ADR 0087) et la recette tourne sur un monde simulé (ADR 0075).

Et Charles veut davantage que lire : qu'un agent fasse pour lui des gestes comme ajouter un chatteur à l'équipe. L'ADR 0026 les range dans « jamais exposé » (gestion des membres, taux, paie), et c'est juste sur le fond : un jeton volé ou un agent manipulé par un fan ne doit jamais suffire à toucher l'équipe ou l'argent. La présente ADR ouvre une voie entre les deux : l'agent prépare, un humain confirme avec son second facteur.

## Décision

### 1. Un jeton ne remplace jamais le second facteur

- Le compte au nom de qui l'agent agit doit avoir son second facteur actif ; sinon chaque appel est refusé, comme `requireRole` refuse la session.
- Aucun outil n'appelle une commande que l'écran garde par une reconfirmation (mot de passe et code, ou passkey) : la route la protège par `recentLogin` ou demande l'identité dans son corps. Un test parcourt le catalogue et échoue si un outil mène à une telle commande autrement que par le § 2.
- Créer, renouveler ou révoquer un accès d'agent reste derrière la reconfirmation (0026 § 3, inchangé).

### 2. Préparer, puis un humain confirme

Une **action préparée** (`prepared_action`) est un geste que l'agent dépose sans effet, et qu'un humain exécute ensuite dans le CRM.

1. L'agent la dépose par un outil `*_prepare`, avec la capacité `prepare:team`. Ses arguments passent par le même schéma Zod que le corps de la route correspondante, plus un motif borné à 500 caractères. Rien ne change dans le CRM à ce moment.
2. Elle apparaît dans « À traiter » de la personne de l'accès : ce qu'elle fera, en phrases, le nom de l'agent, la date. Le texte libre de l'agent y est montré comme une donnée, jamais comme un bouton.
3. Confirmer ouvre l'écran normal du geste, pré-rempli : l'humain relit, peut tout changer, et confirme avec la reconfirmation que ce geste demande déjà (et au moins mot de passe et code de moins de 10 minutes s'il n'en demandait pas). La confirmation appelle la commande de la route, avec ses gardes, au nom de l'humain ; le journal garde l'`id` de l'action préparée et le `grantId`.
4. Refuser est un clic. Une action préparée expire au bout de 72 heures. Elle ne s'exécute jamais par le temps qui passe, par un autre agent ni par un jeton.
5. Seul le propriétaire confirme une action qui touche l'équipe ou l'argent, même si l'accès est au nom d'un manager.
6. Liste fermée en code. Premier geste : **inviter un membre** (prénom, rôle, créatrices). L'e-mail, les identifiants de la plateforme et le taux ne passent jamais par l'agent : le propriétaire les saisit lui-même sur l'écran de confirmation. Viendront ensuite, chacun par une phrase acceptée de cette ADR : changer les créatrices d'un membre, le marquer parti. Un taux ne se prépare jamais : il se tape à l'écran. Au plus 20 actions en attente par accès.

### 3. Ce qui reste fermé, même préparé

Inchangé par rapport à 0026 § 5 : tout envoi ou texte vers un fan, l'approbation d'une proposition, l'Automatique et le test à l'aveugle, la persona et les prompts, les clés et sessions, tout taux ou préréglage de commission, valider ou payer une paie, émettre une facture ou un avoir, le dossier prestataire, toute suppression, les exports de fans, poser `ageConfirmedAt`, les notes du chatteur, tout ce qui dépense le budget IA.

### 4. Le catalogue de lecture suit le CRM d'aujourd'hui

Les outils de 0026 § 5 restent, sous des noms et une adresse Impera (`impera://`, `serverInfo` `impera-mcp`). S'y ajoutent, en lecture seule, par les requêtes des `index.ts` :

| Ce que l'agent lit | Capacité |
|---|---|
| Bilan de la quinzaine, relevés quotidiens de la plateforme, consommation IA du jour | `read:status` |
| Ventes relevées et leur lecture par chatteur | `read:sales` (nouvelle) |
| Fiche du fan remplie par l'IA (champ `untrusted`) | `read:fans` |
| Shifts, qui est en poste, rapports de shift, équipe importée de la plateforme | `read:team` |
| Relevés de commission de la quinzaine | `read:payroll` |
| Dépôts et scripts : titres, étapes, statuts, jamais un média ni son URL | `read:media` (nouvelle) |

Les deux capacités nouvelles sont, comme les autres, jamais cochées d'office.

### 5. Où il tourne

- En recette, `/v1/mcp` sert le monde simulé de l'ADR 0075 : les tests du MCP s'y jouent, jamais sur des données réelles.
- Tant que rien n'est déployé, l'agent est une session Claude Code sur le PC de l'agence, branchée sur `localhost`, son jeton collé dans sa configuration locale, jamais dans un fil. Claude.ai et ChatGPT viennent avec OAuth (lot 4), après le déploiement (0026 § 2, inchangé).
- La recherche d'un accès par l'empreinte de son jeton passe par le rôle de service (ADR 0087), qui ne reçoit que la lecture de la table des accès.

### 6. Ordre des lots

1. Accès d'agent, journal, catalogue de lecture du § 4 (fusionne les lots 1 et 3 de 0026 : l'Équipe existe).
2. Freins de 0026 (lot 2) et actions préparées, avec l'invitation d'un membre.
3. OAuth, après le déploiement.

## Conséquences

- Positives : Charles délègue la saisie (inviter un chatteur, demain d'autres gestes) sans qu'un jeton puisse toucher seul à l'équipe ou à l'argent ; le catalogue suit le CRM réel.
- Négatives : une table et un écran de plus (les actions préparées) ; chaque geste préparé ajouté demande une phrase acceptée.
- À surveiller : qu'un défilé d'actions préparées ne pousse pas à confirmer sans lire. Le plafond de 20 et l'écran pré-rempli à relire sont là pour ça.

## Alternatives rejetées

- **Laisser l'agent créer un membre avec son jeton** : un jeton volé suffirait pour ajouter un compte à l'équipe ou changer un taux, sans second facteur.
- **Confirmer par un code collé dans le fil de l'agent** : le code passerait par le fournisseur du modèle et par la conversation ; il se tape dans le CRM, nulle part ailleurs.
- **Rester en lecture seule** : sûr, mais ne répond pas au besoin de Charles.
