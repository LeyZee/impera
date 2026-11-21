# INS-02 Connecteur de liens en lecture seule : clics par endroit et par heure
Statut : in progress (lots a, b et c faits : contrats, domaine, faux, origine du service, adaptateur en lecture seule, clé scellée du propriétaire, route « Détecter ses liens »)
Phase : Instagram (ADR 0120)
Dépend de : ADR 0120 acceptée
Branche : task/ins-02-link-stats-connector
Propriétaire : fil Instagram ; relecture Bilan (connecteurs) et Sécurité (clé)

## Objectif
Les pages vues et les clics de chaque lien de redirection sont relevés par heure, sans robots, et chaque lien porte son endroit.

## Contexte à lire
ADR 0120 § 3 et § 6, ADR 0080 (lien de redirection), ADR 0016, `docs/playbooks/add-a-connector.md`.

## À faire
- [ ] Contrats Zod : endroit d'un lien (liste fermée), total par lien et par heure.
- [ ] `FakeLinkStats`, puis l'adaptateur ; port sans aucune méthode d'écriture.
- [ ] Clé saisie dans Réglages, scellée, vérifiée au collage.
- [ ] Endroit sur le lien de redirection : migration nouvelle et additive, `NULL` pour les liens déjà enregistrés avec « à renseigner » à l'écran ; écran de Réglages.
- [ ] Upsert sur (lien, heure UTC) : le total est remplacé tant que l'heure n'est pas close, puis figé.
- [ ] Hôte de sortie tiré de la configuration du déploiement, jamais du dépôt ni d'un réglage du CRM ; validé au démarrage ; ni l'hôte ni la clé dans un journal, une erreur, une réponse ou l'audit (avenant du 20/11 à l'ADR 0120 § 3, accepté par Charles).
- [ ] Robots retirés par le code, leur part montrée à l'agence ; aucune donnée de visiteur en base.
- [ ] Alerte rouge d'un lien « story » tombé à zéro (ADR 0120 § 6).

- [ ] Réponses du service lues par un schéma strict : les champs de visite sont écartés à la frontière, avant tout journal ; les journaux ne portent ni clé ni adresse signée.
- [ ] Tables nouvelles : FORCE RLS, `GRANT SELECT … TO impera_service`, test d'isolation ; les totaux ne sont lus que par l'agence.

## Critères d'acceptation
- Tests contre le faux : relevé rejoué sans doublon, heure en cours relue puis figée une fois close, robots exclus, service injoignable en ambre.
- Aucune adresse ni domaine réel dans un test, une fixture ou une doc.

## Hors périmètre
Créer ou modifier un lien chez le service de redirection ; l'entonnoir d'acquisition (lot suivant).

## Notes de session
- 20/11/2026, lot b (demande de Charles du 16/11 : détecter les liens de la créatrice chez le service, les associer, y voir plus clair) : le port gagne `listLinks()` (lecture, aucun chiffre) ; contrats `DetectedLinkSchema` et `LinkProposalSchema` ; `redirect-links/domain/detection.ts` : `linkProposals` reconnaît par son adresse un lien déjà gardé, préremplit le nom et devine l'endroit dans le nom donné chez le service (`placementHint`), sans jamais fabriquer un endroit. Une proposition n'écrit rien : seul le clic d'une personne associe un lien. Aucune table, route ni appel au service.
- Lots suivants : c = clé saisie dans Réglages et scellée, adaptateur officiel (hôte écrit dans le code ; à voir avec Sécurité : le nom d'hôte du service entre alors dans le dépôt public), route « Détecter ses liens » ; d = écran dans l'onglet Liens (avis Design, captures) ; e = référence du service gardée sur le lien (migration additive) et totaux par heure.
- Avis de Sécurité pour le lot c (20/11) : l'hôte du service ne s'écrit pas dans le dépôt public (son nom dit quel outil l'agence utilise). Il vient de la configuration du déploiement (variable d'environnement), jamais d'un réglage du CRM, d'une table ni d'une requête ; validé au démarrage (https, nom de domaine ASCII, port par défaut, ni IP, ni localhost, ni identifiants, ni chemin), sinon le serveur refuse de démarrer ; l'adaptateur n'appelle que lui, sans suivre de redirection, et n'envoie la clé qu'à lui ; `liens.example` dans les tests, nom neutre dans `.env.example`. C'est un écart avec la lettre de l'ADR 0120 § 3 : un amendement court, relu par Sécurité et accepté par Charles, précède le code. L'adaptateur borne aussi le nombre de liens lus par appel.
- 20/11/2026, lot c1 : avenant § 3 accepté par Charles. `LINK_SERVICE_ORIGIN` entre dans la configuration (`linkServiceOriginOf` : exactement `https://<domaine>`, nom public en ASCII, ni port, ni chemin, ni identifiants, ni adresse IP, ni nom local, ni libellé internationalisé) ; absente, le connecteur de liens est éteint ; invalide, le processus refuse de démarrer, sans recopier la valeur dans l'erreur. Rien ne la lit encore. Reste du lot c : la clé scellée dans Réglages et l'adaptateur, qui attendent la description de l'API du service (aucune documentation publique trouvée ; demandée à Charles), puis la route « Détecter ses liens ».
- 21/11/2026, lot c2 : Charles a fourni la description de l'API. Adaptateur en lecture seule (`infra/link-service/rest-link-service.ts`) : une seule fonction d'appel, GET en dur, chemins constants, hôte du déploiement seul, garde de `fetch-avatar` réutilisée (adresses résolues publiques, connexion épinglée, aucune redirection), réponse JSON d'un mégaoctet au plus, vingt pages au plus et jamais de liste partielle, schéma qui ne garde d'un lien que sa référence, son nom et son adresse ; une erreur ne porte que son motif. Clé de l'agence : table `link_service_credentials` (migration 0244), une ligne, scellée avec le contexte `link_service`, RLS forcé sans politique, fermée au rôle applicatif ; routes `/v1/settings/link-service` du propriétaire seul, pose et retrait derrière la connexion récente, la clé n'est gardée que si le service l'accepte, aucune réponse ne la porte. Plafond du rôle de service : +3 pour `modules/connectors` (lire, garder, retirer la clé), parce que la table est fermée au rôle applicatif par conception ; relu par Sécurité. Reste : la route « Détecter ses liens » branchée sur l'adaptateur, l'écran (lot d), les totaux par heure et les robots (lot e).
- 21/11/2026, lot c3 : route `POST /v1/creators/:creatorId/redirect-links/detect`, du propriétaire seul (le compte du service est celui de l'agence, sa liste traverse les créatrices : un manager ne la lit jamais), limitée à cinq par minute. Elle lit d'abord les liens de la créatrice (une créatrice illisible est refusée avant tout appel sortant), puis la liste du service par `connectors.detectedLinks`, et rend les propositions de `linkProposals` ; rien n'est écrit, rien n'est gardé de la liste. Sans clé : 422 `not_connected`, sans appel sortant. La clé du service entre dans `pnpm ops:reencrypt-credentials` et `pnpm ops:check-keys` (demande de Sécurité) : plafond du rôle de service de `modules/connectors` +1 (39), pour ce rechiffrement. Reste : l'écran (lot d), les totaux par heure et les robots (lot e).
