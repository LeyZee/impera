# INS-05 « À décider » : les cartes de décision de la créatrice
Statut : in progress (lot a fait : contrat, table, routes, carte dans « Aujourd'hui » ; rien ne s'affiche tant qu'aucun code ne demande)
Phase : Instagram (ADR 0164)
Dépend de : ADR 0164 acceptée ; ADR 0042 (espace de la créatrice) ; captures « cartes-de-decision-2 » validées par Charles le 21/11/2026
Branche : claude/project-thread-u073g5
Propriétaire : fil Instagram ; relecture Bilan (base, contrats, serveur), Sécurité (droits, cloisonnement), Design (carte)

## Objectif
La créatrice répond d'un geste, sur son téléphone, à une question que le code lui pose sur un de ses contenus ; le propriétaire répond à sa place quand elle ne répond pas.

## Contexte à lire
ADR 0164, ADR 0042 § 2, ADR 0087 (rôles de base), `apps/web/src/screens/today/`, `docs/conventions/hygiene.md`.

## À faire
Lot a, le mécanisme :
- [x] Contrats Zod : décision lue, réponse, décision demandée (réponses accordées à la forme).
- [x] Table `creator_decisions` : FORCE RLS, une fois par sujet, réponse entière ou absente, colonnes d'une réponse seules écrites par le rôle applicatif, lecture seule pour le rôle de service.
- [x] Module `creator-decisions` : sa porte pour le code qui demande (demander, retirer, relire), ses routes (elle lit, répond, met de côté ; le propriétaire lit et répond à sa place, avec une ligne d'audit).
- [x] Carte « À décider » en haut d'« Aujourd'hui » : une question à la fois, compteur, « C'est noté », « Plus tard ».
- [x] Tests : cloisonnement en base, routes de bout en bout, carte.

Lot b, les légendes :
- [ ] Notification d'une question nouvelle, sous les plafonds de `notifications`.
- [ ] Premier code qui demande : trois légendes proposées pour une vidéo déposée, depuis la description du média ; son choix gardé.
- [ ] « D'autres idées » : route, indications en puces et en mots, trois demandes au plus ; appels au modèle comptés dans la conso IA.
- [ ] Écran du propriétaire pour répondre à sa place (captures d'abord).

Lot c, la publication (attend le compte professionnel et l'application Meta) :
- [ ] Confirmation de l'heure, publication d'essai qui marche.

## Critères d'acceptation
- Une créatrice ne lit ni ne répond à la décision d'une autre ; un manager et un chatteur ne lisent rien.
- Une réponse est donnée une fois, par elle ou par le propriétaire ; la seconde est refusée.
- Une décision finie ou retirée ne s'affiche plus et ne se répond plus.
- Aucune donnée réelle dans les tests.

## Résultat
Lot a : voir l'entrée de journal du 21/11/2026.
