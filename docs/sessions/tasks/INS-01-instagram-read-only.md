# INS-01 Instagram en lecture seule : branchement, relevés des médias et des stories
Statut : in progress (lots a et b : contrats, domaine, faux, table des relevés et passage de lecture ; l'essai réel attend le compte professionnel de la créatrice et l'application Meta de l'agence)
Phase : Instagram (ADR 0120)
Dépend de : ADR 0120 acceptée
Branche : task/ins-01-instagram-read-only
Propriétaire : fil Instagram ; relecture Bilan (connecteurs) et Sécurité (jeton, connexion officielle)

## Objectif
Le compte Instagram d'une créatrice se branche avec les seuls droits de lecture, et ses médias, leurs statistiques et ses stories en ligne sont relevés chaque nuit.

## Contexte à lire
ADR 0120 § 1 et § 2, ADR 0057 § 1 et § 2, ADR 0016, ADR 0082 § 1, `docs/architecture/connectors.md`, `docs/playbooks/add-a-connector.md`, la documentation officielle de l'API Instagram au moment du lot.

## À faire
- [x] Contrats Zod : média, relevé, story en ligne ; drapeaux de capacité du port (lecture, publication). (lot a)
- [ ] `FakeInstagramInsights` (lecture ; fait au lot a), puis l'adaptateur officiel ; aucune méthode d'écriture dans ce lot.
- [ ] Branchement dans Réglages › Créatrices par la connexion officielle, droits de lecture seulement ; jeton scellé ; renouvellement par un job ; expiration en ambre.
- [x] Table des relevés : unique par média et par âge, FORCE RLS, `GRANT SELECT … TO impera_service` (lot b, migration 0238).
- [ ] Job de nuit rejouable, et relevé une heure après une publication connue.
- [x] Âge d'un relevé = palier à fenêtre, palier manqué gardé sans nombre (avenant du 20/11 à l'ADR 0120 § 2 ; lot b).
- [x] (lot a, ancienne règle) Âge d'un relevé = palier : première lecture faite après cet âge, heure réelle de la lecture gardée (ADR 0120 § 2).
- [ ] Quota d'appels de Meta par compte et par heure : à l'approche du quota, le job s'arrête en ambre et reprend plus tard, sans jamais boucler.
- [ ] Hôtes de sortie écrits dans l'adaptateur, jamais tirés d'un réglage (ADR 0120 § 3, ADR 0113 § 2).
- [ ] Des nombres seulement : jamais le texte ni le nom d'un commentateur.

- [ ] Secret de l'application Meta de l'agence : saisi dans Réglages et scellé (ADR 0016), jamais dans le dépôt ni un `.env`.
- [ ] Retour de connexion : lié à la session et à la créatrice qui l'a lancé, à usage unique, adresse de retour fixe, échange côté serveur.
- [ ] Droits réellement accordés relus après l'échange : le drapeau de publication en découle, jamais d'un réglage ; un droit non demandé est refusé.
- [ ] Débranchement par la créatrice : jeton effacé, job arrêté.
- [ ] La légende de ses médias est un texte non fiable, typé et délimité dès qu'il entre dans un prompt.

## Critères d'acceptation
- Tests contre le faux : job rejoué sans doublon, jeton expiré en ambre, compte en lecture seule sans drapeau de publication, quota atteint en ambre puis reprise, lecture tardive qui ne remplace pas un palier déjà relevé.
- Route nouvelle : authentication-sweep, origin-sweep, test d'isolation.
- Tests : retour de connexion rejoué refusé, droit non demandé refusé, débranchement qui efface le jeton.

## Hors périmètre
La publication (PUB-02), le retour sur un Reel et l'entonnoir (lot suivant), les commentaires.

## Notes de session
- 20/11/2026, lot a : `packages/contracts/src/instagram-insights.ts`, `connectors/domain/instagram-insights.ts` (port en lecture, `grantOf`, paliers, plan d'une nuit borné par le quota, état du jeton, alerte de deux nuits ratées), `FakeInstagramInsights`. Le faux de lecture est une classe à part de `FakeInstagram` (commentaires, INS-04) : les deux ports n'ont pas les mêmes drapeaux. Aucune table, route ni appel à Meta.
- Lots suivants : b = table des relevés et job de nuit contre le faux (migration, FORCE RLS, GRANT SELECT) ; c = branchement dans Réglages (secret de l'application scellé, retour de connexion à usage unique, débranchement ; relu par Sécurité) ; d = adaptateur officiel, hôtes écrits dans le code, documentation de Meta relue au moment du lot, essai réel sur le mot de Charles.
- Le quota : `callsLeft` garde une marge sous la limite horaire ; la limite elle-même et la façon dont Meta la donne se lisent dans sa documentation au lot d, rien n'est supposé ici.
- À trancher avant le lot de branchement (remarque de Sécurité) : Meta rend en général les droits cumulés du compte pour l'application. Après le second consentement (publication), puis celui des commentaires (ADR 0122), un renouvellement du consentement de lecture verra revenir des droits « non demandés par ce consentement ». La comparaison devra se faire avec « demandés par ce consentement ou déjà consentis chez nous et enregistrés », et un seul module devra tenir l'union des trois listes (lecture, publication, commentaires). Aujourd'hui `grantOf` tient la liste fermée lecture et publication et refuse tout le reste.
- 20/11/2026 : Charles a choisi « Marquer le relevé comme manqué » (avenant à l'ADR 0120 § 2). Schéma de la table des relevés vu avec Bilan pour le lot b : `media_insight_snapshots`, unique (créatrice, média, âge), `missed` avec des nombres nuls, lecture par le propriétaire et un manager actif, fermée à la créatrice et aux chatteurs, écriture par le rôle de service en `insert … on conflict do nothing` (plafond du rôle de service à monter, relu par Sécurité). Le job marque aussi manqué un palier que plus aucune lecture n'atteindra. Le budget d'appels compte `listMedia` (par page) et `listLiveStories`.
- 20/11/2026, lot b : règle du palier à fenêtre (`stepsDue`, `snapshotsOf`, `readingBudget`), table `media_insight_snapshots` (migration 0238) et passage de lecture d'une créatrice (`readMediaInsights`) contre `FakeInstagramInsights`. Sur l'avis de Sécurité, l'écriture ne passe pas par le rôle de service : tâche `media_insights` sous le rôle applicatif (`withTenantJob`), une créatrice à la fois, lecture et insertion seulement ; le plafond du rôle de service ne bouge pas. Un média qu'Instagram ne liste plus garde ses paliers ouverts dans la table et ils sont marqués manqués sans appel. Reste pour le job : la liste des comptes branchés (lot c), le compteur d'appels de l'heure et le nombre de pages de `listMedia` (adaptateur officiel, lot d ; le passage compte une page), le relevé une heure après une publication connue, et l'écran qui lit la table.
