# Démarrer Impera (PC de l'agence)

Le CRM du PC de Charles se met à jour seul au démarrage, puis tourne en version construite sous un superviseur (ADR 0125). Un seul point d'entrée : **« Démarrer Impera »**, lancé par le raccourci du Bureau ou par la tâche planifiée à l'ouverture de session. Plus de `pnpm dev:crm` sur ce PC.

## Ce qu'il fait, à chaque démarrage

1. Démarre la base (`docker compose up -d --wait postgres`), en attendant Docker Desktop jusqu'à 3 minutes.
2. Dépôt modifié à la main, ou pas sur `main` : il démarre la version présente et le dit (ambre).
3. Récupère `main` (avance rapide seulement). Sans réseau, ou rien de nouveau : il démarre la version présente.
4. Sinon : `pnpm install --frozen-lockfile`, puis `pnpm build`.
5. S'il y a des migrations nouvelles (même plusieurs jours d'un coup) : **ta sauvegarde d'abord**, par la commande de `config.json` ; si elle échoue, aucune migration, retour à la version précédente et alerte. Puis `pnpm db:migrate`.
6. Démarre le CRM et vérifie sa santé sous 2 minutes : l'API prête (base, migrations, worker : `/ready`) et le site servi.

Si la nouvelle version ne répond pas : retour au commit précédent, reconstruit, redémarré, et cette version n'est plus retentée tant que `main` n'a pas bougé. Les migrations ne reculent jamais (elles n'ajoutent que). Si l'ancienne version échoue aussi, le CRM reste arrêté, en rouge. Une sauvegarde n'est jamais restaurée toute seule.

**Migration destructive** : une migration nouvelle qui pourrait perdre des données ou baisser une défense n'est jamais lancée par ce chemin. La règle refuse par défaut et ne laisse passer que les formes connues sans perte : un `DROP` est refusé sauf s'il est suivi, avec des espaces seuls entre les deux, de `CONSTRAINT`, `DEFAULT`, `NOT NULL`, `IDENTITY`, `EXPRESSION`, `INDEX`, `POLICY` ou `TRIGGER` ; `TRUNCATE` est refusé partout sauf dans un `GRANT` ou un `REVOKE` ; `DELETE` sauf dans `ON DELETE`, un déclencheur (`… OR DELETE ON`), une règle `FOR DELETE` ou un `GRANT`/`REVOKE` ; `DISABLE ROW LEVEL SECURITY` et `NO FORCE ROW LEVEL SECURITY` sont toujours refusés. Les commentaires sont lus comme le reste : un de ces mots en capitales dans un commentaire suffit à refuser (en minuscules après `--`, c'est de la prose : un « drop » de contenu). On démarre alors la version présente, en ambre, et rien n'est perdu. Pour la laisser passer, tu écris son nom dans `allowDestructiveMigrations` (ci-dessous), c'est ta demande explicite. À titre d'ordre de grandeur, 19 des migrations écrites jusqu'au 16/11/2026 auraient été retenues, presque toutes pour un mot en capitales dans un commentaire.

Ce que la règle ne voit pas, et ne prétend pas voir : un `UPDATE … SET` qui écrase, un `ALTER COLUMN … TYPE … USING` qui convertit mal, le SQL construit dans un `EXECUTE`. Elle attrape l'accident ; contre le reste, il y a la relecture de chaque migration avant `main`, et ta sauvegarde, toujours prise avant.

Le CRM construit écoute comme avant sur cette machine seule : le site sur http://localhost:5173 (`vite preview` des fichiers construits, avec le même relais `/v1` vers l'API qu'en développement), l'API sur le port 3000 avec son worker dans le même processus. Un programme qui plante est relancé après une pause qui grandit (1 s, 2 s, 4 s… une minute au plus).

## Une fois, pour Charles

1. Ferme le terminal où tourne `pnpm dev:crm` : les deux ne peuvent pas tourner ensemble (le programme refuse de démarrer s'il trouve un CRM qui répond déjà).
2. Docker Desktop : Réglages › General › coche « Start Docker Desktop when you sign in to your computer ». Pour que la base redémarre seule, ajoute dans ton `docker-compose.override.yml` (ignoré par git), sous `services:` › `postgres:`, la ligne `restart: unless-stopped`. Le programme démarre la base lui-même de toute façon.
3. Crée le fichier `ops/pc/local/config.json` (ignoré par git) avec la commande de ta sauvegarde, celle que lance ta tâche planifiée de sauvegarde :

   ```json
   {
     "backup": {
       "command": "powershell.exe",
       "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "<chemin complet de ton script de sauvegarde>"],
       "timeoutMinutes": 30
     },
     "allowDestructiveMigrations": []
   }
   ```

   `command` doit être un programme `.exe` (comme `powershell.exe`) : un `.cmd` ou un `.bat` ne se lance pas sans interpréteur, et la sauvegarde serait alors tenue pour échouée (ambre, sans danger). Le programme lance cette commande telle quelle, sans interpréteur entre deux, et la tient pour réussie si elle se termine avec le code 0 dans le temps donné (30 minutes par défaut, 240 au plus). Un champ inconnu ou mal écrit est refusé et le dit dans la fenêtre. Sans ce fichier, ou tant que ta sauvegarde échoue, une mise à jour qui apporte des migrations attend (ambre) ; les autres passent.
4. Double-clique **`Installer le démarrage automatique.cmd`** (dans ce dossier) : il crée la tâche planifiée « Démarrer Impera » à ton ouverture de session, pour ton compte seul, sans droit d'administrateur. Si Windows refuse la tâche, il pose un raccourci dans ton dossier Démarrage à la place. Tu peux le relancer : la tâche est remplacée, jamais doublée.
5. Fais un raccourci de **`Démarrer Impera.cmd`** sur ton Bureau (clic droit › Envoyer vers › Bureau) pour relancer à la main.

## Au quotidien

- Une fenêtre « Impera » s'ouvre à ta session et le CRM y tourne. **Pour l'arrêter proprement : Ctrl+C dans cette fenêtre** (le worker finit ses tâches en cours). Fermer la fenêtre par la croix coupe sans attendre le worker.
- Double-cliquer le raccourci alors qu'Impera tourne déjà ne fait rien de plus (« Impera tourne déjà »).
- Si la fenêtre a été coupée net, l'API s'arrête seule en perdant son superviseur. Dans un cas rare, Windows redonne le numéro du programme coupé à un autre programme, et « Impera tourne déjà » s'affiche à tort : supprime alors `ops/pc/local/running.lock` et relance.
- La fenêtre dit à la fin du démarrage « Mis à jour le … », « Mise à jour échouée, version précédente », ou ce qui retient la mise à jour.

## Les fichiers du programme

Tout ce que le programme garde sur le PC est dans `ops/pc/local/`, ignoré par git :

| Fichier | Contenu |
|---|---|
| `config.json` | Tes réglages (ci-dessus). Écrit par toi seul. |
| `state.json` | Le dernier commit construit, celui dont la base a reçu les migrations, celui qui a échoué, la date de la dernière mise à jour. Effacé, il est reconstruit au démarrage suivant (une construction de plus, rien d'autre). |
| `status.json` | La ligne d'état que le CRM affichera (contrat dans la fiche OPS-17). |
| `journal.log` | Le journal des démarrages : commits (7 caractères), noms de migrations, étapes, durées, statuts. Jamais une valeur, jamais un message. |

Après chaque construction, le programme copie aussi les migrations et les prompts à côté de l'API construite (dossiers `migrations` et `prompts` d'`apps/api`, ignorés par git), là où l'image Docker de production les met.

Le code : `start.mjs` (point d'entrée), `update.mjs` (l'ordre des étapes et le retour arrière), `migrations.mjs` (migrations nouvelles et refus des destructives), `supervisor.mjs` (relance et arrêt propre), `processes.mjs` (git, pnpm, docker, santé), `local-files.mjs` (les fichiers ci-dessus). Tests : `pnpm test:scripts`.

## Pas encore là

- La mise à jour pendant que le CRM tourne, au repos seulement (ADR 0125 § 3) : pour l'instant, une version nouvelle attend le prochain démarrage.
- La ligne dans le CRM (§ 5) : le fichier `status.json` est prêt, son affichage attend l'API et l'écran (fiche OPS-17).
- Le renouvellement du jeton Reveal (§ 6) : fil Extension.
