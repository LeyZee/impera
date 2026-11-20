# INS-02 Connecteur de liens en lecture seule : clics par endroit et par heure
Statut : in progress (lots a et b faits : contrats, domaine, faux, détection des liens sans écran)
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
- [ ] Hôte de sortie écrit dans l'adaptateur, jamais tiré d'un réglage (ADR 0120 § 3, ADR 0113 § 2).
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
