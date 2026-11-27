# 0141. Un copilote qui aide vraiment le chatteur : quoi faire, pourquoi, où en est la vente, et des accroches à la demande

Statut : accepted (« ok 0141 » de Charles, 16/11/2026 à 15 h 54 ; choix « Gratuit + accroches » sur carte à 15 h 44 ; relu par Agent, Sécurité et Design le 16/11) ; amendé le 21/11/2026 (§ 7 : réécrire avec une consigne, choix de Charles sur carte à 15 h 49) ; § 14 amendé par l'ADR 0086 le 21/11/2026 (la vente devient un onglet, choix « C, onglets » de Charles sur carte)
Date : 2026-11-16
Précise : ADR 0086 § 3 (ce que montre le panneau) et § 10 (un copilote qui fait gagner du temps) ; l'ordre du panneau est amendé dans l'ADR 0086 (amendement du 16/11/2026, brouillon au-dessus de la fiche). S'appuie sur ADR 0021 (rester en personnage), 0025 (accès pendant le shift), 0063 (la créatrice ne voit pas la fiche), 0098 (le cerveau choisit parmi ce que le code permet), 0112 (scripts à branches). Ne remplace aucun ADR.

## Contexte

À la recette du 16/11/2026, Charles trouve que le copilote se contente de redire la fiche du fan. Il veut que le panneau aide vraiment le chatteur, sans rien de bateau : quoi faire maintenant, des phrases d'accroche et des réponses prêtes dans la voix de la créatrice, des suggestions intelligentes pour la vente.

Aujourd'hui, le panneau montre la fiche du fan, la ligne « Où on en est » (arrêts, précautions, désir en mots) et, quand l'agent en a écrit un, le brouillon de l'agent. Or l'agent calcule déjà bien plus que ce qu'il montre : l'étape de script décidée et son prix, ce que le fan a refusé, les réponses aux objections déjà utilisées, les relances dues, les raisons de chaque décision et les gardes qui ont joué. Rien de cela n'arrive au chatteur.

Charles a choisi, sur carte, d'afficher d'abord ce qui est déjà calculé (sans coût d'IA), et d'ajouter deux boutons qui appellent l'IA seulement quand le chatteur clique.

## Décision

### A. Ce que le panneau montre sans nouvel appel d'IA

1. **Quoi faire maintenant**, en une ligne au-dessus du brouillon, dans la liste fermée des gestes que le code décide déjà pour chaque brouillon : répondre ; proposer une étape (« Proposer <étape> à <prix> », étape et prix décidés par le code) ; répondre à son objection ; commande perso (accepter, refuser, attendre) ; attendre avant de répondre ; rendre la main à un humain (brouillon tenu, avec sa raison) ; ne rien vendre (avec la raison du blocage, § 2). Le texte de chaque geste est fixé dans le code (libellés français, un par geste) ; le prix vient de la décision du code, jamais d'un texte d'IA. Après un refus final, le geste ne repropose jamais l'étape refusée.

2. **Le pourquoi du brouillon**, en une ligne : les raisons de décision et les gardes qui ont joué, déjà enregistrées avec le brouillon, traduites par une liste fermée de libellés dans `@impera/contracts`. Les blocages de vente gardent les libellés du code : « Ne plus lui écrire », « Un risque bloque la vente », « Ventes gelées », « Âge pas encore confirmé », « Il a dit ne pas avoir d'argent », « Offre trop récente », « Désir encore trop bas ». Une raison sans libellé n'est pas affichée (pas de code brut à l'écran).

3. **Où en est la vente**, dans un pli du panneau : le script en cours et son étape, la prochaine étape et son prix, l'offre faite, les étapes refusées (dérivées du script en cours et des événements d'offre), les réponses aux objections déjà utilisées avec ce fan (à ne pas resservir), une commande personnalisée ouverte.

4. **Les signaux à ne pas rater**, ajoutés à « Où on en est » : désir qui monte ou retombe depuis le message précédent (sens seulement, le chiffre reste au CRM), relance due (un travail à part, pas un geste du brouillon), offre ouverte sans réponse, disponibilité du fan. Les arrêts et précautions existants restent tels quels (rouge pour ce qui interdit, ambre pour ce qui retient).

4 bis. **Le moment de vendre** (choix « Verdict et raisons » de Charles sur carte, 16/11/2026 à 17 h 44, après sa demande de 17 h 43 : des chatteurs vendent trop tôt). Une jauge en crans dit « Bon moment », « Bientôt » ou « Pas encore », avec les deux ou trois conditions qui manquent, en libellés d'une liste fermée dans `@impera/contracts` (par exemple le désir encore trop bas, des messages de lui encore attendus, une offre trop récente). Le verdict est dérivé des mêmes gardes que celles qui autorisent une étape payante au brouillon, jamais d'un second calcul ni d'un texte d'IA. Le chiffre du désir n'est pas montré (il reste au CRM et au Playground). Sous une coupure (§ 9), il n'y a ni jauge ni verdict ; la jauge ne passe jamais devant un arrêt.

5. **Le serveur rend ces données dans la vue du copilote** (la route qui rend déjà le brouillon), recopiées champ par champ, avec un schéma de sortie strict : jamais le texte du prompt, jamais une méthode écrite, jamais un montant autre que le prix de l'étape décidée. Les réponses aux objections déjà utilisées sortent par leur libellé ou par le texte déjà envoyé à ce fan, jamais la banque entière. Aucun champ hors de ce que le chatteur lit déjà pendant son shift.

### B. Deux boutons qui appellent l'IA, au clic seulement

6. **« 3 accroches »** : trois débuts de message différents dans la voix de la créatrice, pour relancer ou ouvrir la conversation. **« Répondre à une objection »** : le chatteur choisit l'objection dans la liste fermée que le code connaît déjà (`OBJECTION_KINDS` : « C'est trop cher », « Pour ce prix j'ai du réel », « Ailleurs c'est gratuit », « Fais-moi un prix », « J'ai déjà payé la dernière fois ») et reçoit une réponse. Une réplique de la banque pas encore utilisée avec ce fan sort d'abord, sans appel d'IA ; l'IA n'écrit que s'il n'y en a pas. « Fais-moi un prix » ne donne jamais de remise. D'autres objections n'entrent dans la liste que sur décision de Charles. Chaque proposition se copie comme un brouillon (« Copier pour Reveal ») ; rien ne part sans le chatteur.

7. **Mêmes gardes que le brouillon** : chaque texte passe par les gardes de sortie du brouillon (rester en personnage, ADR 0021 ; pas de prix ni de remise inventés : un prix ne peut être que celui de l'étape décidée par le code ; pas de rendez-vous concret). Les accroches suivent le curseur de sexualisation de la créatrice (âge non confirmé : rien de sexuel), ne reprennent jamais une réplique déjà envoyée à ce fan, et passent par une réécriture comme le brouillon quand une garde bloque. Un texte encore refusé est retiré, jamais montré. Le corps de l'appel est fermé : la conversation, l'identifiant du message du fan, le bouton et, pour une objection, son type (liste fermée). Aucun texte libre du chatteur, et aucun texte du fan venu de l'extension : le serveur relit le message dans sa base, et ce message entre dans l'appel comme une donnée, dans un bloc délimité et typé. Les réécritures sont bornées comme pour le brouillon et comptées dans le coût.

8. **Coût tenu** : un appel par clic, journalisé dans `llm_calls` avec le membre qui a cliqué, et compté dans le budget IA du jour ; budget du jour épuisé, l'appel est refusé, jamais dépassé. Le même clic sur le même message du fan rend le même résultat sans nouvel appel (clé d'idempotence portée par le tenant, la conversation, le message, le bouton et, pour une objection, son type) ; un résultat gardé n'est rendu qu'après les mêmes contrôles qu'un appel neuf (shift, droits, coupures du § 9) : le cache ne contourne rien. Un plafond de clics par chatteur et par jour, avec une valeur par défaut finie, et une limite par minute sont tenus par le serveur de façon atomique (compteur en base) ; le plafond se règle par le propriétaire seul, dans le CRM, avec une ligne d'audit. Au plafond, le bouton le dit et ne fait rien.

### C. Ce qui coupe tout cela

9. **Doute d'âge ouvert** : ni accroches, ni objection, ni suggestion de vente ; le panneau dit seulement qu'un humain doit lever le doute (règle du 16/11 : l'IA n'écrit plus rien).
   **Fan en difficulté (mode soin)** : ni accroches de vente, ni objection, ni geste de vente dans « quoi faire maintenant » ; le panneau garde la fiche et dit qu'on ne vend pas. À la **sortie du soin**, pendant la période sans explicite (ADR 0088 § 7), ni accroche coquine ni vente.
   **« Ne plus lui écrire »**, **ventes gelées**, **limites non lues** : les gestes de vente et les boutons sont retirés, comme les gestes de copie aujourd'hui pour « Ne plus lui écrire » et les limites non lues.
   Ces coupures sont décidées par le serveur (il ne rend ni les données de vente ni les boutons) et redites par le panneau. Elles sont réévaluées au moment de chaque appel aux boutons, rejeu idempotent compris, pas seulement à l'affichage : un appel malgré une coupure est refusé.

10. **Bornes inchangées** : seulement pendant le shift, sur les créatrices du shift (ADR 0025), contrôlé à chaque appel ; jamais pour la créatrice (ADR 0063) ; les écritures et les appels passent par la liaison de l'extension, jamais par le cookie du CRM (ADR 0086 § 8). Chaque route nouvelle entre dans les balayages d'authentification et d'origine et dans le test d'isolation. Aucun texte de fan ni de proposition dans les journaux.

### D. La forme (avis de Design, 16/11/2026)

11. **Ce qui se lit sans rien ouvrir** : panneau fermé, à 360 px de large et sans défiler, on lit dans l'ordre la bande d'état (le fan et au plus trois pastilles), quoi faire, le brouillon, « Copier pour Reveal » et la vente en une ligne ; la fiche en bref vient dessous (ADR 0086, amendement du 16/11/2026). Tout le reste se replie.
12. **« Quoi faire » et « pourquoi » forment un seul bloc de deux lignes** : le geste en gras, verbe d'abord, sur une ligne ; le pourquoi en petit, encre atténuée. Ton neutre, ambre quand la vente est bloquée, rouge seulement pour le doute d'âge, « Ne plus lui écrire » et les ventes gelées (rouges dans l'en-tête depuis l'ADR 0086 : un seul ton par état). Une coupure (§ 9) remplace ce bloc par une seule phrase qui dit pourquoi, dite une seule fois dans le panneau (pas de ligne en plus sous le brouillon) ; les boutons et gestes de vente disparaissent, jamais grisés.
13. **« Copier pour Reveal » reste la seule action forte.** Les deux boutons d'IA sont discrets, sur une rangée sous le brouillon, jamais néon. Leur résultat s'ouvre sous la rangée, sans remplacer le brouillon ni le pousser hors de l'écran : au plus trois cartes courtes, chacune avec son « Copier pour Reveal », et une croix pour refermer. L'objection se choisit dans des puces à choix unique.
14. **« Où en est la vente »** est un pli fermé par défaut dont la ligne de résumé dit l'étape en cours et la prochaine avec son prix. **« Où on en est »** montre trois signaux au plus, puis « +N ».
15. **États** : en attente d'un clic, un squelette de trois lignes ; échec ou plafond atteint, une phrase sous la rangée. Le nombre de clics restants ne s'affiche que quand il en reste peu. Ni couleur ni composant nouveaux, aucune infobulle native, cibles de 44 px.

### E. Qui fait quoi

16. Agent : les données de la vue (A), la route des boutons et leurs gardes (B), les coupures (C). Extension : le panneau. Design : la forme (§ 11 à 15), et son avis sur les captures (panneau fermé, pli ouvert, accroches, objection, chaque coupure, Nuit et Jour, à 360 px) avant celui de Charles.

## Lots

- **Lot a, sans coût d'IA** : § 1 à 5 et les coupures du § 9 qui les concernent.
- **Lot b, les boutons** : § 6 à 8, avec le réglage du plafond dans le CRM.

## Conséquences

- Positives : le chatteur sait quoi faire et pourquoi en un coup d'œil, avec ce que l'agent sait déjà ; le lot a ne coûte rien en IA.
- Négatives : le panneau porte plus d'informations, au risque de devenir lourd ; la règle de l'ADR 0086 § 10 (lisible en trois secondes) s'applique et la forme du § D l'applique.
- À surveiller : le nombre de clics par jour et leur coût (Conso IA) ; la part des accroches copiées puis envoyées, pour juger si le lot b sert.

## Alternatives rejetées

- **Des accroches à chaque message, sans clic** : un appel d'IA de plus par message pour des textes que le chatteur ne lira souvent pas.
- **Laisser l'IA écrire « quoi faire »** : le code le décide déjà ; un texte libre pourrait contredire la décision ou inventer un prix.
- **Montrer le chiffre du désir** : il reste au CRM ; le sens et le verdict du § 4 bis suffisent au chatteur et évitent qu'il joue le chiffre (option « Verdict et chiffre » écartée par Charles le 16/11/2026).

## Amendement du 21/11/2026 : réécrire avec une consigne

Charles a demandé, en relisant les captures du panneau, que le chatteur puisse faire réécrire le brouillon en disant ce qu'il veut, l'IA faisant le compromis entre la conversation et sa demande. Il a choisi sur carte que la consigne change le ton et le contenu seulement, jamais la vente. Le § 7 interdisait tout texte libre du chatteur dans l'appel ; il est amendé ainsi :

17. **Un troisième bouton, « Réécrire avec une consigne »**, sur la rangée des boutons du lot b, discret comme eux (§ 13). Le chatteur écrit une **consigne du chatteur** de 200 caractères au plus ; l'appel rend un brouillon réécrit qui s'ouvre sous la rangée comme les accroches, avec son « Copier pour Reveal », sans remplacer le brouillon de l'agent.
18. **La consigne est une donnée, jamais une instruction qui passe les gardes.** Elle entre dans l'appel dans son propre bloc délimité et typé, distinct de celui du message du fan ; le prompt dit au modèle qu'il en suit le ton et le sujet dans les limites qui suivent. Le texte rendu passe les mêmes gardes de sortie que le brouillon (§ 7 : rester en personnage, aucun prix ni remise inventés, pas de rendez-vous concret, curseur de sexualisation, rien de sexuel si l'âge n'est pas confirmé), avec la même réécriture bornée et le retrait d'un texte encore refusé.
19. **La vente reste au code.** Une consigne ne peut ni demander une offre, ni changer un prix, ni ouvrir une étape : le seul prix possible reste celui de l'étape décidée par le code, et seulement quand le code propose une vente. Les coupures du § 9 retirent ce bouton comme les autres, et sont réévaluées à chaque appel.
20. **Même coût tenu que les autres boutons (§ 8)** : un appel par clic, le même plafond de clics par chatteur et par jour, la même limite par minute, le budget IA du jour. L'appel est journalisé dans `llm_calls` avec le membre et sa consigne. La clé d'idempotence porte aussi la consigne : la même consigne sur le même message du fan rend le même texte sans nouvel appel.
21. **Qui fait quoi** : Agent, la route, le bloc de la consigne et les gardes ; Extension, le champ et le résultat dans le panneau ; Design, la forme et son avis sur les captures avant Charles.
