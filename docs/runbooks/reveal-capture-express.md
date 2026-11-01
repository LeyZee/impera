# Capture Reveal en 45 minutes

Pour Charles, sur son PC. Version courte de `reveal-recording.md`, qui reste la référence si un mot ici n'est pas clair. Sans cette capture, le connecteur Reveal ne peut pas être écrit : c'est la seule chose qui bloque le vrai bot.

**Avant de commencer (5 min)**

1. Dans Reveal, ajoute à l'équipe un chatteur « bot », avec une adresse mail à toi. Ouvre un **profil Chrome séparé** et connecte-toi avec ce compte.
2. Garde ton téléphone connecté au **fan test**. Tous les envois vont vers lui, jamais vers un vrai fan.
3. Dans le dossier du projet, lance `git pull`.
4. Dans Chrome, appuie sur `F12` et ouvre l'onglet **Network**. Coche **Preserve log**. Le rond rouge doit être allumé.

**Enregistrer (30 min, sans te presser)**

1. Recharge Reveal (`F5`), ouvre la messagerie et fais défiler la liste.
2. Ouvre 3 conversations et remonte un peu dans chacune. Clique sur le panneau de droite : note client, note du modèle, onglet PPV.
3. Ouvre la page Scripts et 2 scripts en entier. Ouvre aussi le coffre et un dossier.
4. Depuis le fan test, envoie un message. Attends qu'il arrive sur le PC.
5. Depuis le PC, au fan test : envoie un texte. Recharge la page (`F5`) et retrouve ce texte dans la conversation.
6. Envoie ensuite une étape de script au fan test. Rouvre le sélecteur de scripts pour voir si l'étape apparaît comme envoyée.
7. Depuis le fan test, envoie une photo et une courte vidéo. Sur le PC, ouvre chacune en grand, puis télécharge-la. Ouvre aussi le bundle envoyé, sans l'acheter.
8. Écris une ligne dans la note client du fan test et enregistre.
9. Attends 15 minutes, puis rouvre la photo et la vidéo.
10. Laisse la messagerie ouverte 5 minutes sans rien toucher.

**Exporter et nettoyer (10 min)**

1. Dans l'onglet Network, clique sur l'icône de téléchargement, puis sur **Export HAR (sanitized)**. Enregistre le fichier dans `.scratch\inbox\` du projet, sous le nom `reveal-AAAA-MM-JJ-a.har`.
2. Dans un terminal, à la racine du projet, lance :
   `node scripts/anonymize-har.mjs .scratch/inbox/reveal-AAAA-MM-JJ-a.har`
3. Relis la liste « mots gardés » que le script affiche. Si un pseudo de fan y apparaît, arrête-toi et dis-le.
4. Supprime le fichier `.har` brut. Garde seulement le fichier `.anon.json`.
5. Écris **« capture déposée »** dans le fil Connexion Reveal.

**Jamais** : n'envoie le fichier brut à personne, ne le colle pas dans le chat, ne le mets pas sur GitHub. Si un cookie a pu fuiter, déconnecte-toi de Reveal sur tous les appareils, puis préviens le fil.
