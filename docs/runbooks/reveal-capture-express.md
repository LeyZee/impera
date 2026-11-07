# Capture Reveal en 50 minutes

Pour Charles, sur son PC. Version courte de `reveal-recording.md`, qui reste la référence si un mot ici n'est pas clair. Sans cette capture, le connecteur Reveal ne peut pas être écrit : c'est la seule chose qui bloque le vrai bot. Relue le 06/11/2026 (`docs/recette/capture-reveal.md`).

**Avant de commencer (5 min)**

1. Dans Reveal, ajoute à l'équipe un chatteur « bot », avec une adresse mail à toi. Ouvre un **profil de navigateur séparé** (Edge ou Chrome, c'est pareil) et connecte-toi avec ce compte « bot ». Toute la capture se fait dans ce profil : jamais avec ton compte.
2. Garde ton téléphone connecté au **fan test** (abonnement actif). Tous les envois vont vers lui, jamais vers un vrai fan.
3. Dans le dossier du projet (`C:\Users\USER\Downloads\Impera Studio`), lance `git pull`.
4. Appuie sur `F12` et ouvre l'onglet **Réseau** (Network). Coche **Conserver le journal** (Preserve log). Laisse le filtre sur **Tout** (All), pour garder le temps réel. Le rond rouge doit être allumé.
5. Prends une feuille : note l'heure de chaque étape (« 14h32 ouvert script »).

**Enregistrer (35 min, sans te presser)**

1. Recharge Reveal (`F5`), ouvre la messagerie, fais défiler la liste et essaie un filtre (non lus).
2. Ouvre 3 conversations et remonte un peu dans chacune. Dans le panneau de droite : note client, note du modèle, statistiques du fan, onglet PPV. Ouvre aussi le profil d'un fan.
3. Ouvre la page Scripts et 2 scripts en entier. Ouvre en grand une vidéo d'une étape de script, puis une vidéo du coffre, 10 secondes chacune.
4. Ouvre la page des ventes ou des statistiques du compte. Si le bot n'y a pas accès, note-le et passe : ne la refais pas avec ton compte dans cette capture.
5. Depuis le fan test, envoie un message. Attends qu'il arrive sur le PC.
6. Depuis le PC, au fan test : envoie un texte, note l'heure à la seconde, recharge (`F5`) et retrouve ce texte.
7. Envoie au fan test un **bundle à 5 €** avec un média du coffre, puis une **étape de script**. Rouvre le sélecteur de scripts : l'étape apparaît-elle comme envoyée ?
8. Envoie au fan test un **vocal** de 10 s avec le bouton micro. Sur ton téléphone, regarde s'il s'affiche comme un vocal ou comme un fichier.
9. Depuis le fan test, envoie une photo et une courte vidéo. Sur le PC, ouvre chacune en grand, puis télécharge-la. Ouvre aussi en grand le bundle envoyé, sans l'acheter.
10. Écris une ligne dans la note client du fan test et enregistre.
11. Attends 15 minutes, puis rouvre la photo et la vidéo.
12. Laisse la messagerie ouverte 5 minutes sans rien toucher.

**Exporter et nettoyer (10 min)**

1. Dans l'onglet Réseau, clique sur l'icône de téléchargement, puis sur **Export HAR (sanitized)**. Jamais la version « with sensitive data ». Enregistre le fichier dans `.scratch\inbox\` du projet, sous le nom `reveal-AAAA-MM-JJ-a.har`.
2. Dans un terminal, à la racine du projet, lance :
   `node scripts/anonymize-har.mjs .scratch/inbox/reveal-AAAA-MM-JJ-a.har`
3. Relis la liste « mots gardés » que le script affiche. Si un pseudo de fan y apparaît, arrête-toi et dis-le.
4. Supprime le fichier `.har` brut. Garde seulement le fichier `.anon.json`.
5. Écris **« capture déposée »** dans le chat du projet, avec ta feuille d'heures et ce que le bot ne voyait pas.

**Jamais** : n'envoie le fichier brut à personne, ne le colle pas dans le chat, ne le mets pas sur GitHub. Si un cookie a pu fuiter, déconnecte-toi de Reveal sur tous les appareils, puis préviens dans le chat.
