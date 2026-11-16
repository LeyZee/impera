# 0125. Le PC de l'agence se met à jour seul au démarrage du CRM, et le jeton Reveal se resynchronise seul

Statut : accepted (« ok 0125 » de Charles le 16/11/2026, 12 h 48 heure de Paris, fil de coordination ; accord écrit du § 7, « ok relance PC », le 16/11/2026, 15 h 06 heure de Paris, fil Bilan ; numéro attribué par le coordinateur le 16/11/2026 ; demande de Charles du 16/11/2026, 2 h 50 heure de Paris : ne plus dépendre de sa présence devant le PC pour les mises à jour ; relecture Sécurité et Extension, § 6 relu par Extension le 16/11)
Date : 2026-11-16
Précise : l'ADR 0029 (sauvegarde chiffrée), l'ADR 0087 (rôle de service), la règle « jamais de migration destructive sans demande explicite » (CLAUDE.md § 12). Ne remplace aucune ADR.

## Contexte

Le CRM tourne sur le PC de Charles. Aujourd'hui, une version nouvelle ne l'atteint que si une session distante récupère le code et que Charles relance lui-même le CRM, dans un terminal ouvert à la main et en mode développement (qui redémarre tout seul à chaque fichier changé). Le 16/11, deux correctifs du connecteur ont attendu ainsi sa présence. Charles éteint son PC la nuit : une mise à jour à heure fixe ne le trouverait pas allumé.

Une seconde dépendance demeure : le jeton de la session Reveal dure environ 24 h, et seul un « Sync » dans l'extension le renouvelle.

## Décision

1. **Un seul point d'entrée : « Démarrer Impera ».** Le raccourci à double-cliquer, et une tâche planifiée Windows à l'ouverture de session de Charles (à son compte, sans droit d'administrateur), lancent le même programme. Il met d'abord à jour, puis démarre le CRM sous un superviseur : API, worker et site en version construite, plus jamais en mode développement sur ce PC. Le superviseur seul peut arrêter le CRM, proprement (worker vidé) ; il n'écoute que sur la machine.

2. **La mise à jour, dans cet ordre, à chaque démarrage :**
   - dépôt propre exigé, sinon on démarre la version présente et on alerte ;
   - récupération de `main`, avance rapide seulement ; sans réseau, on démarre la version présente ;
   - rien de nouveau : on démarre ;
   - sinon : installation figée sur le fichier de verrouillage, construction ;
   - s'il y a des migrations nouvelles, même plusieurs jours de retard d'un coup : sauvegarde chiffrée de la base d'abord, par l'outil de l'ADR 0029, avec la clé qui ne quitte pas le PC, puis les migrations dans l'ordre ;
   - démarrage et santé vérifiée sous deux minutes.

3. **Pendant que le CRM tourne**, une nouvelle version n'est installée que si le CRM est au repos : aucune conversation du Playground active depuis 30 minutes, aucun envoi en cours ou à vérifier, aucun job du connecteur en cours. Sinon, elle attend le prochain démarrage. Rien ne coupe une séance d'entraînement.

4. **Retour arrière.** Si la version nouvelle ne démarre pas, le code repart sur le commit précédent et redémarre. Les migrations ne reculent jamais : elles n'ajoutent que, par règle, et l'ancien code tourne dessus. Si l'ancien code échoue aussi, le CRM reste arrêté avec une alerte rouge. La restauration d'une sauvegarde n'est jamais automatique : elle attend le mot de Charles. Une migration destructive n'est jamais lancée par ce chemin : elle demande sa demande explicite, comme aujourd'hui. La règle qui les reconnaît lit le texte du SQL : elle refuse par défaut et attrape l'accident, mais ne voit ni un `UPDATE` qui écrase, ni une conversion de type ratée, ni le SQL construit dans un `EXECUTE` ; contre ceux-là restent la relecture avant `main` et la sauvegarde prise avant.

5. **Ce que voit Charles.** Une ligne dans le CRM, « Mis à jour » avec la date ou « Mise à jour échouée, version précédente », et la même sur Telegram quand le bot existera. Le journal de la mise à jour ne contient aucune valeur : commits, noms de migrations, durées, statuts.

6. **Le jeton Reveal se renouvelle seul, sous conditions** (relu par le fil Extension ; le détail fera l'objet d'une ADR Extension après celle-ci, relue par Sécurité) :
   - un interrupteur dans Réglages › Ventes, « Renouveler la session Reveal toute seule », **éteint par défaut**, que Charles allume lui-même ;
   - seul le Chrome relié avec le lien du propriétaire le fait : le serveur refuse le Sync à tout autre lien, et le Chrome d'un chatteur ne renouvelle jamais rien ;
   - seulement pour un compte déjà synchronisé une première fois à la main, et seulement si l'onglet ouvert montre le même modèle et le même membre que ceux enregistrés par le serveur ; sinon rien n'est envoyé, et le refus du serveur reste la règle ;
   - jamais de rechargement de l'onglet : l'extension écoute, pendant deux minutes au plus, les requêtes que Reveal fait de lui-même, seulement quand un compte est à renouveler ; le jeton reste en mémoire, part une fois, puis est oublié ;
   - trois essais par compte et par jour au plus ; ensuite, et quand aucun onglet Reveal n'est ouvert, le CRM passe en ambre (« Session Reveal à renouveler : ouvre Reveal dans Chrome ») et ne fait rien d'autre. Un renouvellement réussi s'affiche, sans fenêtre ni son.

7. **Ce qui reste à Charles, une fois :** écrire l'accord qui lève, pour ce seul programme, l'interdiction faite aux fils de relancer le CRM et de lancer les migrations ; installer la tâche par un double-clic ; allumer, s'il le veut, l'interrupteur du § 6 ; mettre Docker Desktop au démarrage de Windows, avec la base qui redémarre seule.

## Conséquences

Positives :
- Un correctif fusionné atteint le CRM au prochain allumage du PC, sans session distante ni geste de Charles.
- Une base n'est jamais migrée sans sauvegarde du jour.
- Le mode développement, qui a relancé le CRM en pleine nuit le 16/11, disparaît du PC.

Négatives :
- Un démarrage avec une mise à jour prend quelques minutes de plus.
- Le Playground garde ses conversations en mémoire : un redémarrage au démarrage du PC les efface, comme aujourd'hui.

À surveiller :
- La durée des démarrages avec mise à jour ; les retours arrière.

## Alternatives rejetées

- **Une tâche à heure fixe la nuit** : le PC est éteint.
- **Laisser une session distante mettre à jour à la demande** : il faut que Charles soit là pour l'autoriser.
- **Héberger le CRM sur un serveur** : c'est la cible, mais elle n'est pas décidée ; cette ADR vaut jusque-là.
