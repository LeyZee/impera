# PUB-02 Connecteur de publication Instagram : Reels, stories, photos, avec l'accord de la créatrice
Statut : blocked (ADR 0057 à accepter ; compte professionnel de la créatrice ; application Meta de l'agence)
Phase : publication (ADR 0057)
Dépend de : PUB-01 (port commun), CR-08, CR-06 (amendée)
Branche : task/pub-02-instagram

## Objectif
Les dépôts Instagram entrent dans le plan de la semaine et partent par l'API officielle, avec la garde de légende, le quota, l'accord de la créatrice et le mode assisté pour les Reels qui ont besoin d'un son.

## Contexte à lire
ADR 0057 (tout), ADR 0016, ADR 0055, la documentation officielle de l'API Instagram (publication de contenu) au moment du lot.

## À faire
- [ ] `FakeInstagram`, puis l'adaptateur : conteneur, état, publication ; quota compté.
- [ ] Branchement du compte par la connexion officielle ; jeton scellé ; expiration en ambre.
- [ ] Adresse signée d'une heure au plus vers une copie convertie (JPEG, vidéo), effacée après, au journal.
- [ ] Garde de légende dans le code (aucune plateforme adulte, lien, prix ou « lien en bio », cinq mots-clés au plus, longueur).
- [ ] Accord de la créatrice : notification la veille, écran d'accord, attente sans réponse à H-2.
- [ ] Mode assisté des Reels : notification avec la vidéo et la légende copiée, « Publié » marqué à la main.
- [ ] Statistiques à 48 h.

## Critères d'acceptation
- Tests contre le faux : quota jamais dépassé, reprise qui relit l'état du conteneur, légende refusée par la garde, publication qui attend sans accord.
- Une publication de test réelle, avec Charles et la créatrice.

## Hors périmètre
La voie Facebook Login (musique) : ADR à part si le mode assisté ne suffit pas.

## Notes de session
