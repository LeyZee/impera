# 0083. Chaque média que la créatrice dépose est décrit en détail, seul, et validé avant tout usage

Statut : accepted (« ok 0083 » de Charles le 08/11/2026, 15 h 19, fil Médias ; demande du 08/11/2026, 15 h 13, fil « Canal Telegram » ; numéro pris par Médias, annoncé au coordinateur)
Date : 2026-11-08
Précise : l'ADR 0030 § 3 (description en deux temps, la parole humaine gagne) et l'ADR 0056 § 6 (description, identité et textes d'un script). Ne remplace rien.

## Contexte

Le rôle `sense` décrit déjà un média (`media/application/describe-media.ts`, prompt `packages/llm/prompts/sense/default.md`) : une à quatre phrases factuelles, des étiquettes fermées (`intensity`, `castMode`, `mood`…), une seule fois par empreinte et par version du descripteur. Il sert aux médias des fans et au catalogue lu dans Reveal. Il n'est branché sur aucun dépôt de la créatrice (ADR 0055) : c'est la fiche SC-04, bloquée par la clé de vision.

Charles veut que tout média déposé dans le pool soit décrit à l'arrivée, assez précisément pour que l'IA qui écrit les textes des posts (Instagram, Telegram, Reveal) et celle qui les programme sachent ce qu'il montre sans le voir. Il donne le prompt qu'il utilise à la main pour les scripts. Ce prompt :
- décrit tout : physique, tenue, pièce, action, position, ce qu'on voit, ce qu'on entend, les paroles dans l'ordre ;
- décrit chaque média comme s'il était le seul : jamais « à nouveau », « la même robe », « même endroit », « toujours », « comme sur la photo précédente » ;
- pour un script, ouvre chaque étape par une description générale (déroulé, objectif, contexte), puis décrit ses médias un par un (« Média 1 = vidéo de 42 secondes ») ;
- finit par une synthèse : le contexte du tournage, un résumé par étape et sa tranche de prix ;
- pose des questions à l'utilisateur quand c'est flou (quelle créatrice, quel contexte, quels prix).

Charles ajoute une précision : la créatrice tourne toujours seule ; un gode réaliste, qui imite la taille et la forme d'un pénis, est souvent décrit par les autres outils comme un vrai pénis, et l'IA qui lit croit alors qu'un homme est présent.

La description de 1 à 4 phrases suffit à réagir au média d'un fan. Elle est trop courte pour écrire un post ou une offre ancrés sur un détail concret.

## Décision

1. **Tout média déposé est décrit à sa réception.** Chaque photo et chaque vidéo d'un dépôt (ADR 0055, toutes catégories : feed, story, relance, script, Instagram) est décrite par le rôle `sense` quand son fichier nettoyé est prêt, par un job rejouable (`content_drops.describe_file`), une fois par empreinte et par version du descripteur (`descriptionKey`, ADR 0030 § 3). Un fichier refusé ou retiré n'est pas décrit. Un vocal reçoit sa transcription (`transcribe`), comme aujourd'hui.

2. **Une description détaillée, en plus des étiquettes.** Le schéma de sortie de la description d'un média de la créatrice gagne un champ `detailed` : physique, tenue, pièce et lumière, action, position, cadrage, ce qu'on entend, et pour une vidéo les paroles recopiées à leur place dans la chronologie (`segments`). La phrase courte (`factualDescription`) et les étiquettes fermées restent : le code s'en sert pour trier et filtrer. Le prompt est un nouveau fichier versionné (`sense/creator-drop.md`), écrit d'après celui de Charles ; changer sa version redécrit les médias non validés, jamais un média validé (ADR 0030 § 3).

3. **Chaque média est décrit seul, par construction.** Un appel par média, sans les médias voisins ni leurs descriptions : le modèle ne peut pas écrire « à nouveau ». Le code vérifie en plus une liste fermée de renvois (« à nouveau », « encore », « la même », « le même », « toujours », « comme sur », « précédent ») ; une description qui en contient est redemandée une fois, puis gardée en ambre pour l'agence.

4. **Elle est seule ; un jouet est un jouet.** Le prompt dit que la créatrice tourne seule et qu'un gode, même réaliste, se décrit comme un jouet (« un gode réaliste »), jamais comme un pénis ni comme une autre personne. Le code ne croit pas le modèle sur ce point : un média de la créatrice dont `castMode` n'est pas `solo`, ou dont un drapeau signale une autre personne, passe en ambre pour l'agence et n'est utilisable qu'une fois validé par un humain.

5. **Le code donne le contexte ; le modèle ne pose jamais de question.** La créatrice, la catégorie, et pour un script l'étape, son carton et sa position (« Média 2 de l'étape 3 ») viennent du dépôt. Ce qui reste flou pour le modèle met `confidenceLow` à vrai : la description passe en ambre pour la validation, sans bloquer le dépôt.

6. **Un script reçoit aussi la description de chaque étape et une synthèse.** Une fois tous ses médias décrits, un appel du rôle `brain` (sortie par schéma) écrit, à partir du carton de l'étape (nom, consignes de la structure) et des descriptions de ses médias, la description générale de chaque étape (déroulé, objectif, ambiance), puis la synthèse du script : contexte du tournage, résumé par étape. **Aucun prix ne vient du modèle** (ADR 0056 § 6) : la synthèse affiche à côté de chaque étape le prix de la grille de l'agence (P6-01), ou « prix à fixer ».

7. **Rien ne sert avant la validation humaine.** Comme toute description (ADR 0030 § 3, ADR 0056 § 6), celle d'un dépôt est validée par l'agence (étape par étape pour un script, « Tout valider » ou correction en ligne) ; la créatrice peut ajouter son ressenti (`creator_note`). Les rôles qui écrivent les textes des posts et des offres ne lisent que la description validée la plus récente ; un média sans description validée n'est proposé à aucun post ni à aucune offre.

8. **Données.** Les descriptions sont des données de la base, sous la politique de la créatrice (`media_descriptions`, ADR 0030) ; aucun média ni aucune description réelle n'entre dans le dépôt, les tests et les évaluations utilisent des médias inventés. Le budget IA du jour (20 €) s'applique : une description en attente de budget est reprise le lendemain, jamais abandonnée.

9. **Avant la clé de vision.** Tout se code et se teste avec l'IA scriptée du bac à sable (ADR 0075). Au branchement de la clé, on vérifie sur quelques vrais médias, hors dépôt, que le modèle de vision accepte le contenu adulte et respecte les § 3 et 4, avant d'activer les descriptions pour une créatrice.

## Conséquences

Positives :
- L'IA des posts et celle des offres écrivent sur un détail concret du média sans jamais le voir.
- Un script arrive avec ses étapes racontées et sa synthèse, prêt pour la validation.
- Le malentendu « un homme dans la vidéo » est arrêté par le code, pas seulement par le prompt.

Négatives, à surveiller :
- Un appel de vision par média : coût et budget du jour à suivre, surtout pour les vidéos longues.
- Une description détaillée est plus longue à relire : l'écran de validation doit montrer d'abord la phrase courte et les ambres.
- Le modèle de vision peut refuser des médias explicites : constaté au § 9, il faudrait choisir un autre fournisseur, par une nouvelle ADR.

## Alternatives écartées

- **Une description pour toute l'étape, en un appel** : le modèle lit les médias ensemble et écrit des renvois (« à nouveau »), ce que Charles exclut.
- **Laisser le modèle poser ses questions** (créatrice, contexte, prix), comme dans le prompt manuel : personne ne répond à un job ; le code donne ce qu'il sait et l'ambre signale le reste.
- **Des prix proposés par le modèle dans la synthèse** : exclu par l'ADR 0056 § 6, les prix viennent de la grille.
