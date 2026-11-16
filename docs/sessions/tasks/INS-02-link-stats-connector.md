# INS-02 Connecteur de liens en lecture seule : clics par endroit et par heure
Statut : todo
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

## Critères d'acceptation
- Tests contre le faux : relevé rejoué sans doublon, heure en cours relue puis figée une fois close, robots exclus, service injoignable en ambre.
- Aucune adresse ni domaine réel dans un test, une fixture ou une doc.

## Hors périmètre
Créer ou modifier un lien chez le service de redirection ; l'entonnoir d'acquisition (lot suivant).

## Notes de session
