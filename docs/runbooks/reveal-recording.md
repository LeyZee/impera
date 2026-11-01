# Enregistrer une session Reveal (capture réseau)

Pour : Charles, sur son PC. Durée : **45 min la première fois** (5 de préparation, 30 de navigation, 10 d'export et d'anonymisation), **10 min** pour la deuxième capture, un autre jour. Pourquoi : Reveal n'a pas d'API publique ; le connecteur s'écrit d'après ce que le site web de Reveal échange avec ses serveurs. Ce qu'on cherche : `docs/reference/reveal-connector-inventory.md`.

Version courte, une page : `reveal-capture-express.md`. Cette méthode utilise les outils de développement de Chrome (fichier HAR). L'enregistreur de l'extension (fiche P1-01) la remplacera pour les captures suivantes et la détection des changements d'API.

## Les règles

- **Rien n'est envoyé à un vrai fan.** Les écritures (message, PPV, script, note) se font uniquement vers un **fan test** : un compte Reveal à toi, abonné à Messalina. Sans fan test, saute les étapes marquées ✉.
- **Le fichier brut ne sort jamais du PC.** Il contient les conversations de vrais fans. Seul le fichier `.anon.json` produit par le script est partagé, et il reste dans `.scratch/inbox/` (ignoré par git). Jamais sur GitHub (ADR 0010), jamais collé dans le chat, jamais dans le dossier partagé du projet.
- **Si un cookie ou un jeton a pu fuiter** (fichier brut envoyé par erreur, export « avec données sensibles ») : déconnecte-toi de Reveal sur tous les appareils, reconnecte-toi, et préviens le fil. La déconnexion invalide la session capturée.

## 1. Préparer (5 min)

0. **Compte du chatteur bot** (décision du 17/10) : crée une adresse mail dédiée que tu contrôles, ajoute un chatteur à ce nom dans l'équipe Reveal, et connecte-le dans un **profil Chrome séparé**. La capture se fait dans ce profil, connecté en tant que bot : elle montre exactement ce qu'un chatteur peut voir et faire, et c'est ce que l'agent pourra faire. Si une page manque à ce chatteur (statistiques, revenus), refais seulement cette étape avec ton compte et note-le. Le mot de passe reste dans ton gestionnaire de mots de passe, jamais dans le chat ni dans un fichier.

1. Dans le dossier du dépôt (`C:\Users\USER\Downloads\Projet Nirvana`), récupère la dernière version : `git pull`. Vérifie `node -v` (22.13 ou plus).
2. Ouvre Chrome avec le profil connecté au compte créatrice de Messalina sur Reveal.
3. Ouvre les outils de développement (`F12`), onglet **Network** (Réseau). Coche **Preserve log** (Conserver le journal). Laisse le filtre sur **All** (Tout), pour garder les WebSocket.
4. Vérifie que le rond rouge en haut à gauche est actif (enregistrement en cours).

## 2. Jouer le parcours (30 min)

Fais les étapes dans l'ordre, sans te presser : chaque clic produit les requêtes qu'on veut voir.

| # | Action | Couvre |
|---|---|---|
| 1 | Recharge la page Reveal (`F5`) | L1 état de la session |
| 2 | Ouvre la messagerie, fais défiler la liste des conversations sur 2 ou 3 pages, essaie les filtres (non lus, etc.) | L2 boîte de réception |
| 3 | Ouvre 3 conversations : un fan qui a acheté, un fan récent, une longue conversation. Dans chacune, remonte l'historique de 2 ou 3 pages | L3 messages, historique |
| 4 | Ouvre le profil de chacun de ces fans : infos, dépenses, listes ou étiquettes | L5 profil, L6 achats |
| 5 | Dans le panneau de droite de chacune de ces conversations : note client, notes du modèle, statistiques du fan, sans rien modifier. Ouvre aussi l'onglet PPV et parcours ses statistiques | L7, L11, L12, L13 |
| 6 | Ouvre la page des scripts : la liste, les dossiers, puis 2 ou 3 scripts en entier (étapes, médias, prix) | L8 scripts |
| 7 | Dans la conversation d'un fan qui a déjà reçu des scripts, ouvre le sélecteur de scripts sans rien envoyer : regarde s'il montre ce qui a déjà été envoyé | L9 scripts déjà envoyés |
| 8 | Ouvre le coffre (médias), parcours un dossier | L10 coffre |
| 8b | Ouvre en grand une **vidéo** d'une étape de script (page Scripts), lance-la 10 secondes, puis fais de même avec une vidéo du Vault. Si un bouton « télécharger » existe, clique dessus | L15 fichiers originaux |
| 9 | Ouvre la page des ventes ou statistiques, puis un relevé détaillé | L6 ventes |
| 10 | ✉ Depuis ton téléphone, avec le fan test, écris à Messalina. Garde la conversation ouverte sur le PC et attends que le message arrive | L4 temps réel |
| 11 | ✉ Dans la conversation du fan test : envoie un texte, puis un PPV (un média du coffre, 5 $), puis une étape d'un script | E1, E2, E3 |
| 11a | ✉ Juste après le texte de l'étape 11, note l'heure à la seconde, puis recharge la conversation (`F5`) et remonte jusqu'à ce message. Ne renvoie rien d'autre. La capture garde ce que Reveal répond à l'envoi (identifiant du message, horodatage) et la relecture du fil : c'est ce qui permet de vérifier qu'un envoi est bien parti avant de le refaire | E5 vérification d'envoi |
| 11b | ✉ Avec le fan test, envoie à Messalina une photo puis une courte vidéo. Sur le PC, dans la conversation : ouvre la photo en grand, puis clic droit « Ouvrir l'image dans un nouvel onglet » (ou bouton télécharger s'il existe) ; lance la vidéo 10 secondes, puis télécharge-la si un bouton le permet. Ouvre aussi en grand un média du bundle envoyé à l'étape 11, **pas encore acheté** par le fan test (média verrouillé) | L14 fichiers des médias de fan, `FetchMedia` (vision) |
| 11d | ✉ Attends au moins 15 minutes (fais les étapes 12 et 13 pendant ce temps), puis rouvre la photo et la vidéo du fan test de l'étape 11b. La capture montre alors si les liens des fichiers expirent et comment Reveal en donne de nouveaux | L14 liens signés |
| 11c | ✉ Au fan test : enregistre un vocal de 10 s avec le bouton micro et envoie-le. Essaie ensuite d'importer un petit fichier audio (.mp3) dans « Envoyer des médias », puis dans un bundle à 5 €. Sur ton téléphone (fan test), regarde si chacun s'affiche comme un vocal (lecteur avec onde) ou comme un fichier | E7 vocal |
| 12 | ✉ Rouvre le sélecteur de scripts du fan test : l'étape envoyée est-elle marquée ? | L9, E3 |
| 13 | ✉ Écris une ligne dans la note client du fan test, enregistre | E4 |
| 14 | ✉ Avec le fan test, achète le PPV si c'est possible sans frais excessifs, sinon passe | L6, L4 achat |
| 15 | Ne touche plus à rien pendant 5 minutes, page de messagerie ouverte | L4 fréquence du polling |

Pendant la navigation, note sur papier ce que tu as fait et l'heure (ex. « 14h32 ouvert script X ») : ça aide à relier une requête à une action.

## 3. Exporter (2 min)

1. Dans l'onglet Network, clique sur l'icône de téléchargement (**Export HAR**). Choisis **Export HAR (sanitized)** : Chrome retire alors cookies et en-têtes d'authentification. Ne choisis jamais la version « with sensitive data ». Si ton Chrome ne propose qu'un seul « Export HAR », c'est la version nettoyée, tant que le réglage « Allow to generate HAR with sensitive data » reste décoché. Le script de l'étape 4 retire de toute façon ce qui resterait.
2. Enregistre dans `.scratch\inbox\` du dépôt, nommé `reveal-<date>-a.har` (ex. `reveal-2026-10-18-a.har`).
3. Ferme les outils de développement.

## 4. Anonymiser (5 min)

Dans un terminal, à la racine du dépôt :

```
node scripts/anonymize-har.mjs .scratch/inbox/reveal-2026-10-18-a.har
```

Le script remplace les secrets restants, les textes, les pseudos, les emails et les identifiants (hachés de façon stable avec un sel gardé dans `.scratch/inbox/.anon-salt`, qui ne sort pas du PC). Il refuse d'écrire si un motif sensible survit. Il affiche :

- le nombre de requêtes et de trames WebSocket ;
- la liste des endpoints appelés ;
- les **mots gardés tels quels** : relis-la. Ce doivent être des mots techniques (`sent`, `ppv`, `text`…). Si un pseudo de fan y apparaît, ne partage rien et dis-le dans le fil : on renforce le script.

Puis **supprime le fichier `.har` brut**. Si l'analyse a besoin de plus, on refait une capture.

## 5. Prévenir

Écris dans le fil Connexion Reveal : « capture déposée ». Le fil lit `.scratch/inbox/*.anon.json` dans le dossier du dépôt sur ton PC (avec ton autorisation), remplit `docs/reference/reveal-api-observed.md` et construit FakeReveal (fiche P1-02).

## Deuxième capture (10 min, un autre jour)

Étapes 1 à 3 et 6 du parcours, même export, même anonymisation (même sel). Elle sert à vérifier que les identifiants et les endpoints sont stables (question 4 de `docs/architecture/connectors.md`).
