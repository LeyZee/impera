# Bilan du projet Impera, 8 novembre 2026

Demandé par Charles le 08/11 à 16h27 : « analyse tout le projet et tire un bilan ». Lu sur `main` à `c38159c` (Telegram A2, #654), avec les trois PR ouvertes (#653, #655, #657), la CI de GitHub, les 140 fiches, les ADR, et la doc métier hors dépôt (méthode de chatting, référence de l'API CRM). Aucun code modifié. Aucune donnée réelle ici.

Ce document est volontairement franc. Il dit ce qui marche, mais il s'attarde sur ce qui ne va pas, parce que c'est là que se joue la suite.

## En une phrase

**Le socle technique est de très bonne facture, mais le projet a construit autour du cœur au lieu de construire le cœur : l'agent de chatting n'a encore jamais lu ni envoyé un seul message sur Reveal, et ne peut pas le faire en l'état.**

## Les chiffres

| Mesure                                         | Valeur                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Âge du projet                                  | 23 jours (premier commit le 16/10/2026)                                           |
| Code TypeScript                                | ~360 000 lignes (API 173 k, web 138 k, contrats 22 k, base 16 k, extension 5 k, IA 3 k) |
| Fichiers de test                               | ~830                                                                              |
| Modules de l'API                               | 23                                                                                |
| Migrations                                     | 121 (numérotées jusqu'à 0138, avec des trous)                                     |
| ADR                                            | 82 acceptées (0001 à 0083, sans 0061 ni 0082)                                     |
| Fiches de tâches                               | 140 : 40 faites, 41 en cours, 18 à faire, 18 bloquées, 22 proposées, 1 en revue    |
| Journal des sessions                           | 623 entrées                                                                       |
| Documentation (`docs/`)                        | ~500 000 mots, soit 5 à 6 romans                                                  |
| Lignes du connecteur de conversation Reveal    | **0**                                                                             |
| Endpoints Reveal documentés (`reveal-api-observed.md`) | **0** (fichier vide)                                                      |
| Messages écrits par l'agent sur un vrai modèle d'IA, évalués | **0** (les évals de nuit sont sautées : « clé absente »)            |

Répartition du code de l'API par grande famille (lignes, tests compris) :

| Famille                                                                             | Lignes  | Part |
| ----------------------------------------------------------------------------------- | ------- | ---- |
| Gestion d'équipe et argent (paie, planning, factures, prestataires, compta, équipe) | ~46 000 | 27 % |
| Agent et conversation (agent, conversations, fans, persona, supervision, playground) | ~25 000 | 14 % |
| Connecteurs (dont 90 % pour les ventes de l'API CRM, 0 % pour la messagerie)        | ~11 000 | 6 %  |
| Telegram (alertes et canal)                                                         | ~10 000 | 6 %  |
| Contenu (dépôts, scripts, médias, tâches créatrice, veille)                          | ~14 500 | 8 %  |
| Socle (auth, sécurité, sauvegardes, jobs, câblage)                                  | le reste |     |

Ce tableau résume le bilan : un quart du code sert la paie et les factures d'une équipe de trois chatteurs, et zéro ligne ne parle à la messagerie de Reveal.

---

## 1. Architecture

### Organisation

```
apps/api        Fastify + workers Graphile (même code, deux entrées), 23 modules domain/application/infra
apps/web        CRM et PWA (Vite, React, TanStack), 59 routes, un shell par rôle
apps/extension  WXT MV3 : popup qui lit la session du CRM, veille Instagram ; pas d'enregistreur, pas de capture
packages/contracts  schémas Zod partagés (événements, DTO, jobs)
packages/db         Drizzle, migrations, RLS (withTenant / withAdmin)
packages/llm        LlmGateway à trois rôles (brain, voice, sense) + judge, budget, journal llm_calls
packages/design-system  tokens et classes nv-*
evals/          45 scénarios (28 normaux, 17 adversariaux), seuils
```

### Points forts (réels, vérifiés dans le code)

1. **Monolithe modulaire propre.** Chaque module a son `domain/` pur, ses ports, son `index.ts` ; `eslint-plugin-boundaries` interdit les raccourcis. C'est le bon choix pour une équipe d'une personne : un seul déploiement, des frontières nettes, un découpage en services possible plus tard.
2. **Le cœur ne connaît pas Reveal** (ADR 0003, 0008). Le port `PlatformConnector` et le second port `PlatformSalesFeed` (ADR 0050) permettront d'ajouter une autre plateforme, puis la vôtre, sans toucher au moteur.
3. **Les règles métier sont dans le code, pas dans les prompts** : gardes (`ai_disclosure`, mineur, rencontre, paiement hors plateforme, fausse urgence), politique d'offre, délais, curseur de sexualisation, Jour/Nuit. C'est exactement ce que demande la méthode de chatting (« vérifié par le code, pas par le modèle »).
4. **Le message du fan est traité comme une donnée** (`untrusted.ts`, blocs délimités), avec des évals d'injection. Peu de projets du secteur font ça.
5. **Journal d'événements + idempotence** (ADR 0007) : unicité sur `platform_message_id`, clés d'idempotence à l'envoi, jobs rejouables, file par conversation. C'est ce qui évite le double envoi à un fan, l'erreur la plus coûteuse du métier.
6. **Sécurité au-dessus de la moyenne** : clés chiffrées en base, jamais renvoyées, double facteur, passkeys, ré-authentification pour les gestes sensibles, limiteur de débit, liste de mots de passe compromis, gitleaks en pré-commit.

### Dettes et incohérences

1. **La structure prévue pour le cœur est vide.** `connectors/infra/` contient `fake/` et `reveal-crm/` (ventes), rien d'autre. En production, la table des connecteurs vaut `{}` (`composition-root.ts:291`). Toute la chaîne ingestion → brouillon → envoi tourne seulement contre `FakeConnector`.
2. **L'extension n'a aucune des trois fonctions de son README.** Elle devait être : 1) l'enregistreur (P1-01, `todo`), 2) la capture de session (P2, rien), 3) le relais. Elle fait aujourd'hui un popup et la veille Instagram. Sa raison d'être première n'est pas codée.
3. **Volume sans rapport avec la taille de l'agence.** 360 000 lignes pour une créatrice, une plateforme, trois chatteurs. Chaque ligne se maintient, se relit, se migre. Vous êtes développeur web : honnêtement, ce code n'est plus maintenable par vous seul sans les sessions d'IA. C'est un risque de dépendance (« bus factor ») à regarder en face.
4. **Gouvernance plus lourde que le produit.** 82 ADR, des phrases d'ADR validées mot pour mot, 623 entrées de journal, 500 000 mots de doc. Ces garde-fous ont servi au début (cohérence entre sessions), mais ils coûtent maintenant plus qu'ils ne protègent : une décision d'écran passe par une ADR, une relecture croisée, des captures en Nuit/Jour, PC/téléphone, puis un mot-clé. Le rythme y passe.
5. **Beaucoup de chantiers ouverts en même temps.** 41 fiches « en cours », 18 « bloquées ». Peu de fiches vont jusqu'au bout parce que de nouvelles s'ouvrent sur chaque idée (veille Instagram, fiche reel, canal Telegram, sondages, description auto des médias...).
6. **Nom hérité.** `nirvana_app` reste le nom du rôle de base et apparaît encore dans la doc (renommage ADR 0062 incomplet côté base). Mineur.

**Verdict architecture : bonne, saine, cohérente dans sa forme. Le problème n'est pas la forme, c'est l'ordre dans lequel on l'a remplie.**

---

## 2. Robustesse et fiabilité

### Ce qui est solide

- **CI complète et verte sur les pushes** : typecheck, lint des frontières, prettier, knip, check-repo, dérive du schéma, tests unitaires (~2 min), tests d'intégration Testcontainers (~10 min), e2e, audit des dépendances, build, et même démarrage des images Docker avec un export et une restauration de sauvegarde. C'est le niveau d'une équipe produit sérieuse.
- **RLS** : 106 tables en `FORCE ROW LEVEL SECURITY`. Les 28 tables hors RLS sont des tables d'authentification ou système (`user`, `session`, `two_factor`, `telegram_*`, `sales_feed_*`, `backup_*`, `audit_log`), ce qui est cohérent avec un seul tenant. Le harnais d'isolation vérifie chaque route.
- **Journal des migrations** : vérifié aujourd'hui, les 121 entrées ont un `when` strictement croissant. Le piège Drizzle n'a pas encore mordu `main`.

### Ce qui est fragile ou cassé

| #   | Constat                                                                                                                                                                                                                                                                                                                   | Gravité  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | **Aucun connecteur de messagerie Reveal.** L'agent ne peut ni lire ni envoyer. Tout le reste du produit « agent » est donc non prouvé en conditions réelles.                                                                                                                                                                | bloquant |
| R2  | **Qualité IA jamais mesurée.** Les 45 évals existent, l'exécuteur aussi, mais la tâche de nuit « Nightly evals smoke » s'arrête à « Évaluations sautées, clé absente ». Les prompts `brain` et `voice` (64 et 69 lignes) n'ont jamais été calibrés sur Grok 4.7 ni sur la persona réelle (inactive).                       | bloquant |
| R3  | **CI de nuit rouge** : le job gitleaks (historique complet) échoue sur `main` (run du 08/11 9h43). `CLAUDE.md` dit qu'un rouge sur `main` est une anomalie à signaler : la voici. Des « ok gitleaks » ont été donnés fil par fil, ce qui laisse le rouge vivre.                                                             | majeur   |
| R4  | **Le piège Drizzle n'est gardé par rien.** Aucun test ne vérifie que le `when` du journal est croissant. Avec trois PR qui portent chacune une migration (0139, 0140, 0141) et l'ordre de fusion décidé à la main, une migration peut être sautée en silence en production. Un test de 15 lignes suffit.                   | majeur   |
| R5  | **Plantage d'`undici` (MED-04, recette du 07/11)** : un stockage S3 qui répond `Connection: close` fait tomber l'API et le worker ; le job reste verrouillé jusqu'à 4 h. Il y a un contournement local (`node-get.ts`), mais aucun `process.on('uncaughtException' / 'unhandledRejection')` journalisé dans l'API. En prod, Docker relance (`unless-stopped`), mais on perd la trace et un job reste coincé. | majeur   |
| R6  | **Rien n'est déployé.** Le CRM tourne sur le PC de Charles. Pas de sauvegarde réelle, aucun essai de restauration réel (OPS-02 « reste le premier essai »), donc la paie ne doit pas partir pour de vrai (EQ-17 l'interdit, à raison).                                                                                    | majeur   |
| R7  | **Trois PR empilées et une migration réservée hors `main`** (#653 → #655, #657, A3 avec 0139). Chaque fusion décale les autres. Plus on attend, plus le rechaînage coûte.                                                                                                                                                  | moyen    |
| R8  | **Vérité sur l'API CRM non confirmée** : `memberId` = auteur de la session, membre « bot » sous son propre `chatterId`, concordance au centime de `netAmount` (ADR 0050 § 8). Prévu le 16/11. Tant que ce n'est pas fait, la paie « détectée » est théorique.                                                               | moyen    |
| R9  | **Docs qui décrochent du code** : la roadmap date du 17/10 et parle encore du dépôt privé `LeyZee/nirvana` (il est public et renommé), le README de l'extension promet trois fonctions absentes.                                                                                                          | mineur   |

### Ce qui casserait en réel, dans l'ordre où vous le verriez

1. Brancher l'agent : impossible, R1.
2. Première conversation avec une clé xAI : on découvrira la vraie qualité de la voix, sans évals de référence, R2. Probable : trop long, trop poli, tics d'IA, ou au contraire gardes trop sensibles qui renvoient tout aux chatteurs.
3. Mise en ligne sur un VPS : premier vrai Postgres, premier vrai stockage S3, MED-04 à revérifier, sauvegardes jamais restaurées.
4. Paie détectée : écart `netAmount` contre le dashboard non vérifié.

### Verdict net

- **L'agent de chatting : non utilisable en réel.** Pas par manque de qualité du code, mais parce que la pièce qui le relie à Reveal n'existe pas et que sa qualité n'a jamais été mesurée.
- **La gestion d'équipe (planning, rapports, commissions déclarées, alertes Telegram) : utilisable en réel**, à trois conditions : 1) déployée sur un serveur et plus sur votre PC, 2) sauvegardes en place et une restauration réussie, 3) CI de nuit remise au vert.
- **Le registre des ventes par l'API CRM : utilisable en lecture** dès maintenant (clé branchée sur le PC), **pas pour payer** avant la vérification du 16/11.

---

## 3. État par chantier

Légende : ✅ fait et fusionné · 🟡 en cours · 📄 décidé (ADR) mais pas codé · ⛔ bloqué par une action externe · ⏸ non joué.

| Chantier                                         | État | Ce qui manque, concrètement                                                                                                         | Bloqué par                  |
| ------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Connexion Reveal, messagerie** (P1-01 à P1-03, P2) | ⛔ | Capture HAR (50 min, runbook `reveal-capture-express.md`), puis `reveal-api-observed.md`, FakeReveal fidèle, `RevealApiConnector` lecture, envoi, transmission de la session du bot par l'extension | **Charles : la capture**    |
| Enregistreur de l'extension (P1-01)              | ⏸    | Pas commencé ; la capture à la main le remplace pour la première fois                                                               | rien                        |
| Moteur IA (brain/voice/sense, gardes, politique) | 🟡   | Codé et testé avec une passerelle simulée ; jamais branché sur un vrai modèle                                                       | clé xAI                     |
| Évals                                            | 🟡   | 45 scénarios prêts, jamais joués                                                                                                    | clé xAI                     |
| Persona Messa 2.0.0                              | 🟡   | Chargée en base locale, **inactive** ; fidélité à Desirali à confirmer                                                              | Charles : « charge et active » |
| Ventes par l'API CRM (ADR 0050)                  | 🟡   | Lecture en place ; vérification de fiabilité le 16/11 ; bascule « détecté » au 01/12 ; « ok novembre-reveal » en attente             | Charles                      |
| Chatteurs Reveal reliés (EQ-20)                  | 🟡   | Codé ; liaison à faire dans Réglages › Ventes › Équipe Reveal                                                                       | Charles                      |
| CRM-03 paie détectée                             | ⛔   | Interdit tant que la vérification n'est pas faite                                                                                   | 16/11                        |
| Ventes Reveal E10–E28, devises, factures          | ⏸    | Non joué en recette                                                                                                                 | —                           |
| Paie, planning, rapports, factures (EQ-01 à 21)  | 🟡   | Très avancé ; mise en service (EQ-17) attend sauvegardes et restauration                                                            | déploiement                  |
| Sauvegardes (OPS-02)                             | 🟡   | Code fini ; bucket, paire age, premier essai de restauration                                                                        | déploiement                  |
| Déploiement                                      | ⏸    | Rien ; reco OVHcloud                                                                                                                | Charles : choisir et payer  |
| Telegram alertes                                 | ✅   | —                                                                                                                                   | —                           |
| Telegram canal Messa A1, A2                       | ✅   | —                                                                                                                                   | —                           |
| Telegram canal A3 (envoi auto, aperçu)           | 🟡   | Migration 0139, trois points à trancher ; Charles doit créer le bot et coller ses exemples                                          | Charles                      |
| Dashboard agence (0078, 0081)                    | ✅   | —                                                                                                                                   | —                           |
| Espace créatrice (PWA, agenda, dépôts, scripts)  | 🟡   | Socle fait ; brief hebdo (CR-07) attend xAI ; feed et Mass DM attendent la capture                                                 | xAI, capture                |
| Médias : description auto (ADR 0083, #657)       | 🟡   | Lot a en brouillon ; `validated_by` à corriger ; lots b et c ; attend la clé de vision                                              | clé Google                   |
| Scripts : textes de vente (SC-05), envoi à Reveal (SC-06) | ⛔ | Grille de prix P6-01, clé xAI, capture                                                                                    | plusieurs                   |
| Veille Instagram et fiche reel (VEI)             | 🟡   | VEI-08 (#655) derrière #653 ; VEI-03 à 06 bloquées (xAI, compte pro, appli Meta)                                                    | plusieurs                   |
| Publication Instagram (PUB-02)                   | ⛔   | Compte pro, appli Meta                                                                                                              | Charles                      |
| MCP (0026, quatre fiches proposées)              | 📄   | Rien                                                                                                                                | —                           |
| D10, archive > 4 Go                              | ⏸    | Non joué                                                                                                                            | —                           |
| Clés xAI, Google, Mistral, ElevenLabs             | ⛔   | Aucune                                                                                                                              | Charles                      |

Ce que vous aviez peut-être oublié, en plus de la capture : **la clé xAI** (sans elle, rien de l'IA n'a jamais été vu), **l'activation de la persona**, **le déploiement**, **la CI de nuit rouge**, et **les trois PR ouvertes** qui vieillissent.

---

## 4. Pertinence par rôle

Je juge ici au regard de la méthode de chatting (`chatting/methode-chatting.md`) et de ce que fait une agence au quotidien : un fan qui paie, un chatteur qui vend, une modèle qui tourne du contenu, un manager qui pilote.

### 4.1 Charles, manager d'agence

**Ce qui apporte vraiment de la valeur dès aujourd'hui**

1. **Le registre des ventes Reveal par l'API CRM** et le Dashboard agence : CA par type de vente, par chatteur, par jour, remboursements à part. C'est une vraie source de vérité, officielle, sans dépendre d'une session.
2. **Le contrôle des rapports par les ventes réelles** (ADR 0073) : un chatteur ne peut plus déclarer un chiffre faux. C'est précisément le problème de management « trop permissif » que vous vouliez régler.
3. **Planning, rapports de fin de shift, rappel push, commissions** : la gestion d'équipe d'Imperium, en mieux.
4. **Alertes Telegram** : savoir sans ouvrir le CRM.

**Ce qui manque pour que ce soit indispensable**

1. **L'agent qui chatte.** C'est la promesse du projet et le seul levier qui change l'économie de l'agence (heures de nuit couvertes, réponse en moins de 2 min, zéro oubli de relance).
2. **La mesure de l'agent face aux humains** : CA par conversation, taux de conversion de la première offre, panier moyen, temps de réponse, bot contre chatteurs sur la même période. Les briques existent (attribution `chatterId`, membre « bot ») mais pas l'écran de comparaison.
3. **Le CRM en ligne**, accessible de partout, pas sur le PC.

**Ce qui est superflu ou prématuré**

1. **La chaîne de facturation complète** (avoirs, factures rectificatives, résidence fiscale qui bloque le virement, rendu PDF) : ~11 000 lignes pour trois prestataires. Une paie qui sort un relevé juste et un export suffisaient au lancement.
2. **La veille Instagram et les fiches reel** avant d'avoir un compte pro relié : bien pensé, mais ça ne vend rien aujourd'hui.
3. **Les ADR et captures pour des choix d'écran.** Gardez l'ADR pour ce qui touche l'argent, la sécurité, les données et le comportement de l'agent.

### 4.2 Le chatteur

**Ce qui apporte vraiment de la valeur**

1. **Sa commission estimée et son palier, en direct sur son téléphone** : c'est le meilleur motivateur qui soit pour un chatteur payé à la commission.
2. **Fin de la saisie des ventes** une fois le compte en « détecté » : 10 secondes de feedback au lieu d'un rapport.
3. **Son planning et ses échanges de shifts.**

**Ce qui manque pour que ce soit indispensable**

1. **L'aide pendant qu'il chatte**, là où il passe 95 % de son temps : dans Reveal. Le panneau latéral de l'extension (fiche PROPOSED-copilot-extension) avec la note du fan, son historique d'achats, les scripts déjà reçus, le prochain pas suggéré, et un brouillon de l'agent en un clic. Aujourd'hui, l'outil le gère (planning, paie) mais ne l'aide pas à vendre.
2. **La note du fan partagée** entre l'agent et les chatteurs (CRM-06, `todo`) : la mémoire KYC est le cœur de la méthode, elle doit suivre le fan quel que soit celui qui répond.
3. **Le passage de relais agent ↔ humain** propre (EQ-08, bloqué par la capture) : le bot chauffe, le chatteur conclut une grosse vente, ou l'inverse la nuit.

**Ce qui est superflu**

- Pas grand-chose côté chatteur. Le risque est inverse : il a l'outil de gestion, pas l'outil de vente.

### 4.3 La modèle (Messa)

**Ce qui apporte vraiment de la valeur**

1. **Les demandes de tournage avec cartons et fiche reel** : elle sait quoi filmer, dans quel ordre, Jour ou Nuit, et l'agence récupère un dossier rangé. C'est le vrai gain de temps pour une créatrice.
2. **Ses gains lus chez Reveal** (`modelRevenue`), sans calcul maison.
3. **Le canal Telegram qui poste seul**, avec aperçu 1 h avant : du trafic sans effort.

**Ce qui manque pour que ce soit indispensable**

1. **Une seule entrée « aujourd'hui »** sur le téléphone : ce qu'on attend d'elle, en trois lignes, et rien d'autre. Elle a aujourd'hui agenda, dépôts, scripts, idées, persona, gains, canal : c'est beaucoup d'écrans pour quelqu'un qui doit « comprendre d'un coup d'œil, zéro effort » (votre consigne du 08/11).
2. **Un retour simple sur ce qui vend** : « ce script a rapporté X € cette semaine », « ce type de média part le mieux ». C'est ce qui la motive à tourner plus et mieux.

**Ce qui est superflu**

- L'agenda détaillé et l'écran Persona côté modèle : utiles à l'agence, pas à elle au quotidien.

---

## 5. Ce qu'il faut faire

Effort : **S** = une session, **M** = 2 à 4 sessions, **L** = une à deux semaines de sessions. « Vous » = une action de Charles hors code.

### 5.1 Corriger (à faire tout de suite, petits et sûrs)

1. **Remettre la CI de nuit au vert (gitleaks)** : identifier le faux positif ou le secret dans l'historique, l'ajouter à `.gitleaksignore` avec justification, ou le révoquer. S.
2. **Test qui garde le journal Drizzle** : `when` strictement croissant et chaque `.sql` présent dans le journal, dans `pnpm check`. S.
3. **Gestionnaire de plantage dans l'API et le worker** : `uncaughtException` et `unhandledRejection` journalisés puis arrêt propre ; fixer `undici` ou passer un `Agent` explicite pour le S3 (MED-04). S.
4. **`validated_by` de #657** et fusion de #653 → #655 → #657 dans cet ordre, sans en ouvrir d'autre avant. S.
5. **Docs à jour** : roadmap (date du 17/10, dépôt public et renommé), README de l'extension (ce qu'elle fait vraiment). S.

### 5.2 Ajouter (ce qui manque pour que le projet tienne sa promesse)

1. **La capture Reveal** (vous, 50 min), puis `reveal-api-observed.md` et FakeReveal fidèle (P1-02). M.
2. **`RevealApiConnector` en lecture seule**, conversations visibles dans Suivi en moins de 60 s (phase 2). M.
3. **Une clé xAI**, puis évals `smoke` jouées et 2 à 3 séances de playground avec la persona réelle pour caler la voix. Vous + M.
4. **Envoi manuel depuis le CRM, puis copilote** (brouillon de l'agent, validé par un humain), sur le fan « test » d'abord. M.
5. **Déploiement sur un VPS** (OVHcloud recommandé : hébergement en France, prix bas, assez pour ce volume), sauvegardes, première restauration. Vous + M.
6. **Panneau copilote dans l'extension** pour les chatteurs. L.
7. **Écran « Agent contre humains »** : conversion, panier, délai de réponse, CA par conversation. M.
8. **Note du fan partagée** agent + chatteurs (CRM-06). M.

### 5.3 Optimiser

1. **Une PR = une fiche, mais une fiche = une semaine maximum.** Fermer ou découper les 41 fiches « en cours ». S de tri.
2. **Alléger la cérémonie** : ADR seulement pour argent, sécurité, données, comportement de l'agent ; pas pour un écran. Captures validées en un lot par semaine, pas par PR. Vous.
3. **Un seul fil de code actif à la fois sur un même module**, pour éviter les migrations réservées et les PR empilées. Vous.
4. **Budget IA** : quand la clé arrive, le prompt `brain` passera à chaque message ; mesurer le coût par conversation dès la première semaine et poser une limite par fan, pas seulement par jour.

### 5.4 Améliorer

1. **Écran de la modèle « Aujourd'hui »** en une carte : ce qu'on attend d'elle, échéance, un bouton. M.
2. **Retour « ce qui vend » pour la modèle.** S à M.
3. **Glossaire et doc** : un document d'une page pour vous (« comment marche Impera »), séparé de la doc pour les sessions. S.

### 5.5 Supprimer ou geler

Je ne propose de supprimer aucun code fusionné : il est testé et ne gêne pas. Je propose de **geler**, c'est-à-dire de ne plus y ouvrir de fiche avant que l'agent ait envoyé son premier vrai message :

1. Factures : avoirs, rectificatives, résidence fiscale (on garde la paie et les relevés).
2. Veille Instagram, fiche reel après #655, PUB-02, PUB-03, VEI-03 à 06.
3. MCP (quatre fiches proposées).
4. Telegram A3 au-delà de ce qui est en cours, et le lot B.
5. Fiches « proposed » issues de l'étude Desirely : à refondre en une seule fiche après la phase 2.
6. Description auto des médias, lots b et c (le lot a se fusionne, éteint par défaut).

---

## 6. Verdict global

**Solide ? Oui, techniquement.** Le code est typé, testé, sécurisé, et la CI est d'un niveau rare pour un projet de trois semaines. Les choix de fond (monolithe modulaire, cœur sans plateforme, règles dans le code, journal d'événements, idempotence) sont les bons, et ils tiendront quand vous ajouterez d'autres créatrices ou votre propre plateforme.

**Utile ? Pas encore, pour ce qu'il promet.** Aujourd'hui Impera est un très bon outil de gestion d'équipe et de lecture des ventes, et un agent de chatting sur le papier. La valeur qui justifie le projet (un bot qui vend comme Messa, la nuit, sans se trahir) n'a jamais été vue fonctionner. Tant que ce n'est pas le cas, chaque nouvelle fonction autour augmente le coût de maintenance sans augmenter le revenu.

La bonne nouvelle : **ce qui bloque n'est pas du code, ce sont deux actions de votre côté** (50 minutes de capture et une clé xAI), et tout ce qui vient après est déjà préparé (FakeReveal, ports, gardes, évals, runbooks). Le chemin vers le premier vrai message est court si on arrête d'ouvrir des chantiers.

### Les 5 prochaines actions, dans l'ordre

1. **Vous : faire la capture Reveal** avec le runbook `docs/runbooks/reveal-capture-express.md` (50 min, profil « bot », fan « test »). Rien d'autre ne débloque autant.
2. **Vous : brancher une clé xAI** dans Réglages, activer la persona Messa, et laisser jouer les évals `smoke`. On saura enfin si la voix tient.
3. **Code : corriger les 5 points du § 5.1** (CI de nuit, garde Drizzle, plantage, fusion des trois PR, docs) pendant que la capture s'analyse.
4. **Code : connecteur Reveal en lecture, puis copilote sur le fan « test »**, puis envoi validé par un humain sur de vrais fans, en Copilote seulement.
5. **Vous + code : déployer sur OVHcloud** avec sauvegardes et une restauration réussie, pour que l'équipe utilise le CRM sans votre PC et que la paie puisse partir.

### Ce que vous avez à trancher

- **« ok gel »** : aucun nouveau chantier (fiche, ADR, écran) hors des 5 actions ci-dessus tant que l'agent n'a pas envoyé son premier message validé en Copilote. Ma reco : oui.
- **« ok cérémonie-légère »** : ADR seulement pour l'argent, la sécurité, les données et le comportement de l'agent ; captures validées par lot hebdomadaire. Ma reco : oui.
- **« ok ovh »** : déploiement sur un VPS OVHcloud (fiche à écrire). Ma reco : oui, après la capture, pas avant.
