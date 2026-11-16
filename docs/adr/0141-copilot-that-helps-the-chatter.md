# 0141. Un copilote qui aide vraiment le chatteur : quoi faire, pourquoi, où en est la vente, et des accroches à la demande

Statut : proposed (fil « Extension, connexion Reveal et playground », 16/11/2026 ; choix de Charles sur carte le 16/11 à 15 h 44 : « Gratuit + accroches » ; à relire par Agent, Design et Sécurité ; attend « ok 0141 »)
Date : 2026-11-16
Précise : ADR 0086 § 3 (ce que montre le panneau) et § 10 (un copilote qui fait gagner du temps). S'appuie sur ADR 0021 (rester en personnage), 0025 (accès pendant le shift), 0063 (la créatrice ne voit pas la fiche), 0098 (le cerveau choisit parmi ce que le code permet), 0112 (scripts à branches). Ne remplace aucun ADR.

## Contexte

Le 16/11/2026, Charles teste le copilote sur un vrai fan et trouve qu'il « ne fait que répéter les notes ». Il veut que le panneau aide vraiment le chatteur, sans rien de bateau : quoi faire maintenant, des phrases d'accroche et des réponses prêtes dans la voix de la créatrice, des suggestions intelligentes pour la vente.

Aujourd'hui, le panneau montre la fiche du fan, la ligne « Où on en est » (arrêts, précautions, désir en mots) et, quand l'agent en a écrit un, le brouillon de l'agent. Or l'agent calcule déjà bien plus que ce qu'il montre : l'étape de script décidée et son prix, ce que le fan a refusé, les réponses aux objections déjà utilisées, les relances dues, les raisons de chaque décision et les gardes qui ont joué. Rien de cela n'arrive au chatteur.

Charles a choisi, sur carte, d'afficher d'abord ce qui est déjà calculé (sans coût d'IA), et d'ajouter deux boutons qui appellent l'IA seulement quand le chatteur clique.

## Décision

### A. Ce que le panneau montre sans nouvel appel d'IA

1. **Quoi faire maintenant**, en une ligne au-dessus du brouillon, dans une liste fermée de gestes que le code décide déjà : proposer une étape (son nom et son prix, décidés par le code), relancer, attendre sa réponse, rendre la main à un humain, ne rien vendre (une garde joue). Le texte de chaque geste est fixé dans le code (libellés français, un par geste) ; le prix vient de la décision du code, jamais d'un texte d'IA.

2. **Le pourquoi du brouillon**, en une ligne : les raisons de décision et les gardes qui ont joué, déjà enregistrées avec le brouillon, traduites par une liste fermée de libellés. Une raison sans libellé n'est pas affichée (pas de code brut à l'écran).

3. **Où en est la vente**, dans un pli du panneau : le script en cours et son étape, la prochaine étape et son prix, les étapes refusées, les réponses aux objections déjà utilisées avec ce fan (à ne pas resservir), une commande personnalisée ouverte.

4. **Les signaux à ne pas rater**, ajoutés à « Où on en est » : désir qui monte ou retombe depuis le message précédent (sens seulement, le chiffre reste au CRM), relance due, offre ouverte sans réponse. Les arrêts et précautions existants restent tels quels (rouge pour ce qui interdit, ambre pour ce qui retient).

5. **Le serveur rend ces données dans la vue du copilote** (la route qui rend déjà le brouillon), recopiées champ par champ, avec un schéma de sortie strict : jamais le texte du prompt, jamais une méthode écrite, jamais un montant autre que le prix de l'étape décidée.

### B. Deux boutons qui appellent l'IA, au clic seulement

6. **« 3 accroches »** : trois débuts de message différents dans la voix de la créatrice, pour relancer ou ouvrir la conversation. **« Réponse à une objection »** : le chatteur choisit l'objection dans une liste fermée (trop cher, une autre fois, pas le moment, il doute) et reçoit une réponse. Chaque proposition se copie comme un brouillon (« Copier pour Reveal ») ; rien ne part sans le chatteur.

7. **Mêmes gardes que le brouillon** : chaque texte passe par les gardes de sortie du brouillon (rester en personnage, ADR 0021 ; pas de prix ni de remise inventés : un prix ne peut être que celui de l'étape décidée par le code ; pas de rendez-vous concret). Un texte refusé par une garde est retiré, jamais montré. Le message du fan entre dans l'appel comme une donnée, dans un bloc délimité et typé.

8. **Coût tenu** : un appel par clic, journalisé dans `llm_calls` comme le reste et compté dans le budget IA du jour. Le même clic sur le même message du fan rend le même résultat (clé d'idempotence par message et par bouton), sans nouvel appel. Un plafond de clics par chatteur et par jour est réglable par le propriétaire dans le CRM ; au plafond, le bouton le dit et ne fait rien.

### C. Ce qui coupe tout cela

9. **Doute d'âge ouvert** : ni accroches, ni objection, ni suggestion de vente ; le panneau dit seulement qu'un humain doit lever le doute (règle du 16/11 : l'IA n'écrit plus rien).
   **Fan en difficulté (mode soin)** : ni accroches de vente, ni objection, ni geste de vente dans « quoi faire maintenant » ; le panneau garde la fiche et dit qu'on ne vend pas.
   **« Ne plus lui écrire »**, **ventes gelées**, **limites non lues** : les gestes de vente et les boutons sont retirés, comme les gestes de copie aujourd'hui pour « Ne plus lui écrire » et les limites non lues.
   Ces coupures sont décidées par le serveur (il ne rend ni les données de vente ni les boutons) et redites par le panneau ; un appel aux boutons malgré tout est refusé par le serveur.

10. **Bornes inchangées** : seulement pendant le shift, sur les créatrices du shift (ADR 0025) ; jamais pour la créatrice (ADR 0063) ; les écritures et les appels passent par la liaison de l'extension, jamais par le cookie du CRM (ADR 0086 § 8).

### D. Qui fait quoi

11. Agent : les données de la vue (A), la route des boutons et leurs gardes (B), les coupures (C). Extension : le panneau. Design : la forme, avant l'avis de Charles sur les captures.

## Lots

- **Lot a, sans coût d'IA** : § 1 à 5 et les coupures du § 9 qui les concernent.
- **Lot b, les boutons** : § 6 à 8, avec le réglage du plafond dans le CRM.

## Conséquences

- Positives : le chatteur sait quoi faire et pourquoi en un coup d'œil, avec ce que l'agent sait déjà ; le lot a ne coûte rien en IA.
- Négatives : le panneau porte plus d'informations, au risque de devenir lourd ; la règle de l'ADR 0086 § 10 (lisible en trois secondes) s'applique et Design tranche ce qui se replie.
- À surveiller : le nombre de clics par jour et leur coût (Conso IA) ; la part des accroches copiées puis envoyées, pour juger si le lot b sert.

## Alternatives rejetées

- **Des accroches à chaque message, sans clic** : un appel d'IA de plus par message pour des textes que le chatteur ne lira souvent pas.
- **Laisser l'IA écrire « quoi faire »** : le code le décide déjà ; un texte libre pourrait contredire la décision ou inventer un prix.
- **Montrer le chiffre du désir** : il reste au CRM ; le sens suffit au chatteur et évite qu'il joue le chiffre.
