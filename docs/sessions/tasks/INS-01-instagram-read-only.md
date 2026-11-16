# INS-01 Instagram en lecture seule : branchement, relevés des médias et des stories
Statut : blocked (ADR 0120 proposée ; compte professionnel de la créatrice ; application Meta de l'agence)
Phase : Instagram (ADR 0120)
Dépend de : ADR 0120 acceptée
Branche : task/ins-01-instagram-read-only
Propriétaire : fil Instagram ; relecture Bilan (connecteurs) et Sécurité (jeton, connexion officielle)

## Objectif
Le compte Instagram d'une créatrice se branche avec les seuls droits de lecture, et ses médias, leurs statistiques et ses stories en ligne sont relevés chaque nuit.

## Contexte à lire
ADR 0120 § 1 et § 2, ADR 0057 § 1 et § 2, ADR 0016, ADR 0082 § 1, `docs/architecture/connectors.md`, `docs/playbooks/add-a-connector.md`, la documentation officielle de l'API Instagram au moment du lot.

## À faire
- [ ] Contrats Zod : média, relevé, story en ligne ; drapeaux de capacité du port (lecture, publication).
- [ ] `FakeInstagram` (lecture), puis l'adaptateur officiel ; aucune méthode d'écriture dans ce lot.
- [ ] Branchement dans Réglages › Créatrices par la connexion officielle, droits de lecture seulement ; jeton scellé ; renouvellement par un job ; expiration en ambre.
- [ ] Table des relevés : unique par média et par âge, FORCE RLS, `GRANT SELECT … TO impera_service`.
- [ ] Job de nuit rejouable, et relevé une heure après une publication connue.
- [ ] Des nombres seulement : jamais le texte ni le nom d'un commentateur.

## Critères d'acceptation
- Tests contre le faux : job rejoué sans doublon, jeton expiré en ambre, compte en lecture seule sans drapeau de publication.
- Route nouvelle : authentication-sweep, origin-sweep, test d'isolation.

## Hors périmètre
La publication (PUB-02), le retour sur un Reel et l'entonnoir (lot suivant), les commentaires.

## Notes de session
