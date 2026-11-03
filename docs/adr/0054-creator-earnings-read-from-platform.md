# 0054. Gains de la créatrice : les chiffres de Reveal dès que son modèle est relié, sans attendre la bascule

Statut : accepted (Charles, 03/11/2026 09h45, « ok 0054 », sur les mots exacts de la phrase du § 1 ; décision du même jour à 09h32, « ok recos », recommandation 4 de la fiche CRM-04)
Date : 2026-11-03
Remplace : dans l'ADR 0042 § 6, la phrase « La source des ventes est celle de la paie pour ce compte (ADR 0023, ADR 0043) : les ventes saisies par les chatteurs, puis les ventes détectées. »
Précise : l'ADR 0042 § 6 (la chaîne, le pourcentage de l'agence et « à régler » ne valent que pour une plateforme dont Nirvana ne lit pas le registre des ventes) et l'ADR 0050 § 8 (`modelRevenue` fait foi sur son écran dès que le modèle est relié, et non plus seulement sur un compte basculé).
Les ADR 0042 et 0050 restent telles quelles ; l'index des ADR renvoie d'elles à celle-ci.

## Contexte

L'ADR 0042 § 6 lie les gains de la créatrice à la source de la paie de son compte : les ventes saisies par les chatteurs, puis les ventes détectées. L'ADR 0050 a changé la donne pour Reveal. Nirvana lit le registre des ventes de Reveal par l'API CRM (CRM-01), avec les montants de Reveal, dont la part de la créatrice (`modelRevenue`). Sur un compte basculé, cette part fait foi sur son écran (ADR 0050 § 8).

Sur un compte Reveal pas encore basculé, la paie de l'équipe reste sur les rapports de shift, et aucune vente n'y est saisie une à une. Avec la phrase de l'ADR 0042, son écran Ventes resterait vide jusqu'à la bascule, qui attend une quinzaine vérifiée et l'accord de Charles (ADR 0050, garde de bascule de CRM-03).

La fiche CRM-04 a posé la question le 03/11 (question 4), avec une recommandation : oui, dès que le modèle est relié. Charles l'a acceptée (« ok recos », 09h32). Il avait déjà dit de la part de la créatrice : « c'est le chiffre de Reveal […] c'est le plus fiable » (ADR 0050 § 8).

## Décision

1. **La phrase qui remplace celle de l'ADR 0042 § 6** : « La source de ses gains dépend de la plateforme du compte. Sur une plateforme dont Nirvana lit le registre des ventes (Reveal, ADR 0050), c'est ce registre, dès que le modèle de la plateforme est relié au compte, que la paie de l'équipe sur ce compte soit déjà sur les ventes lues ou encore sur les rapports : chaque montant du parcours, sa part comprise (`modelRevenue`), est celui de la plateforme, et l'écran le dit (« lus chez Reveal »). Sur une autre plateforme, c'est la source de la paie pour ce compte (ADR 0023, ADR 0043) : les ventes saisies par les chatteurs. »
2. **Sur Reveal, le pourcentage de l'agence ne fait aucun montant.** La chaîne d'Imperium, le pourcentage réglé et la mention « à régler » de l'ADR 0042 § 6 valent pour une plateforme dont Nirvana ne lit pas le registre. Sur Reveal, sa part s'affiche même sans pourcentage réglé. Le pourcentage sert seulement à signaler au propriétaire un écart avec `modelRevenue` qui dépasse un centime par vente, sur un compte et une quinzaine, à titre d'information (fiche CRM-04, question 5).
3. **Ce qui ne change pas.** Les montants restent « estimés » tant que la période n'est pas close (ADR 0042 § 6). Elle ne voit jamais qui a vendu, ni chatteur ni agent (fiche CRM-04, question 1) : elle lit ses ventes par une vue qui n'a pas le vendeur (CRM-04, lot d), et la base dit la même chose que l'écran (ADR 0042 § 2). Ce qu'elle voit ne change rien à la paie de l'équipe : un compte non basculé reste payé sur ses rapports.

## Conséquences

Positives :
- Son écran Ventes vit dès que la clé de l'agence est posée et le modèle relié, sans attendre la bascule.
- Sa part n'a qu'un chiffre, celui de Reveal, avant comme après la bascule.

Négatives, à surveiller :
- Avant la bascule, son écran (lu chez Reveal) et la paie de l'équipe (rapports) partent de deux sources. Elle ne voit jamais l'écart ; c'est la vérification CRM-02 qui le mesure, côté agence.
- Si la lecture s'arrête (clé révoquée, modèle délié), une journée sans vente ne doit pas se confondre avec une journée non lue : CR-04 dit depuis quand les chiffres ne sont plus lus.

## Alternatives rejetées

- **Attendre la bascule** : un écran vide pendant des semaines, alors que le chiffre de Reveal est le plus fiable.
- **Calculer sa part avec la chaîne et le pourcentage sur les ventes lues** : deux chiffres pour la même vente, le nôtre et celui de Reveal. Charles a choisi celui de Reveal.
- **Lui montrer les rapports de shift** : ce sont des totaux par chatteur, pas des ventes, et ils diraient qui a vendu.
