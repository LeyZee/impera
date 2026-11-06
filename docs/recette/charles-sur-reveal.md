# Ce que Charles teste lui-même sur Reveal

Tout se fait avec le **fan « test »** (seule cible d'envoi) et la **session du membre « bot »** (jamais la tienne). Aucune clé ni aucun mot de passe dans le chat : les clés se collent dans le CRM, les mots de passe restent dans ton gestionnaire.

## Avant la capture (10 min)

1. **Réactive l'abonnement du fan « test »** sur ton téléphone, et vérifie qu'il reçoit un message de Messa.
2. **Crée le membre « bot »** dans l'équipe Reveal (adresse mail à toi), puis connecte-le dans un profil de navigateur séparé. Dis-moi s'il voit : les scripts, le coffre, la note client, la note du modèle, l'onglet PPV, les statistiques, les ventes.

## La capture (50 min, une fois)

3. **Fais la capture** en suivant `docs/runbooks/reveal-capture-express.md`, mise à jour dans cette PR (bundle, vocal, vidéos de script et du coffre ajoutés). Pendant la capture, réponds à ces trois questions sur ta feuille :
   - l'étape de script envoyée apparaît-elle comme « déjà envoyée » dans le sélecteur ?
   - le vocal arrive-t-il sur le téléphone comme un vocal (avec l'onde) ou comme un fichier ?
   - après 15 minutes, la photo et la vidéo du fan se rouvrent-elles normalement ?
4. **Anonymise, supprime le brut, écris « capture déposée »** dans le chat du projet.

## L'API CRM de Reveal (20 min)

5. **Crée une clé d'agence** dans Reveal (Paramètres › CRM / API), limitée à Messa, et **colle-la dans Impera › Réglages › Ventes** (jamais ailleurs).
6. **Relie** dans Réglages › Ventes le modèle de Messa à sa fiche, et le membre « bot » à l'agent. Dis-moi si une vente apparaît en « chatteur non relié ».
7. **Télécharge l'export CSV** du dashboard Reveal sur la dernière quinzaine terminée (du 16 au 31/10), puis lance **« Vérifier »** dans Réglages › Ventes avec ce fichier. Envoie-moi seulement le verdict affiché (concorde, écart, incomplet) et le nom des colonnes si Impera dit qu'il ne les reconnaît pas, jamais le fichier.
8. **Fais acheter le bundle de 5 €** au fan « test » (si les frais restent raisonnables). Dans les deux minutes, la vente doit apparaître dans Impera (Dashboard, ventes lues chez Reveal), attribuée à l'agent. Dis-moi le délai observé.

## Au support de Reveal (un message)

9. **Demande l'ouverture des webhooks** pour l'agence (ventes en 10 à 30 secondes au lieu d'une minute), et **pose la question des « clés de bots »** que cite leur documentation : existe-t-il une clé qui lit les conversations ? La réponse peut éviter une partie du connecteur par session.

## Plus tard, quand le connecteur existera

10. Copilote sur le fan « test » seulement : il t'écrit, l'agent propose, tu approuves dans Suivi, le message arrive sur ton téléphone une seule fois.
11. Coupe internet pendant un envoi, puis rallume : le fan « test » ne doit jamais recevoir deux fois la même bulle.
12. Déconnecte le « bot » de Reveal sur tous les appareils : Impera doit le dire (session expirée) et s'arrêter d'écrire, puis reprendre quand tu le reconnectes.

Ce qui t'attend aussi dans le CRM (pas sur Reveal) : valider les captures d'écran que les fils de recette vont produire.
