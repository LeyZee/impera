# Le dispositif de capture de l'écran Reveal : relecture

Relu le 06/11/2026 : `docs/runbooks/reveal-capture-express.md` (la page que Charles suit), `docs/runbooks/reveal-recording.md` (la référence), `scripts/anonymize-har.mjs` et ses tests, `docs/reference/reveal-connector-inventory.md` (ce que le connecteur doit savoir faire, L1 à L15 et E1 à E7), `docs/reference/reveal-api-observed.md` (vide), FakeReveal et ses enregistrements (vides).

## Verdict

Le dispositif tient : méthode HAR « sanitized », anonymiseur testé qui refuse d'écrire si un motif sensible survit, sel local, fichier brut supprimé, rien sur GitHub ni dans le chat, et la suite (FakeReveal, enregistrements, test de fidélité) attend la capture. Mais la page express ne couvrait pas tout l'inventaire, et les deux pages se contredisaient sur le compte à utiliser. Une capture faite avec la page express telle quelle aurait obligé à en refaire une.

## Ce qui manquait ou était faux (corrigé dans cette PR)

| # | Problème | Effet | Correction |
|---|---|---|---|
| 1 | `reveal-recording.md` disait d'ouvrir Chrome « avec le profil connecté au compte créatrice de Messalina », alors que l'étape 0 et la décision du 17/10 disent : session du membre « bot », jamais celle de Charles | capture faite avec le mauvais compte : on ne saurait pas ce que le bot voit | les deux pages disent « profil séparé connecté en tant que bot » |
| 2 | La page express n'envoyait aucun PPV (bundle), mais demandait d'« ouvrir le bundle envoyé » | E2 et L14 (média verrouillé) absents | étape ajoutée : un bundle à 5 € au fan « test » |
| 3 | Pas de vocal (E7) dans la page express | on ne sait pas si un vocal cloné peut partir | étape ajoutée |
| 4 | Pas de fiche du fan, de statistiques du compte, ni d'ouverture d'une vidéo de script ou du coffre en grand (L5, L6, L12, L15) | l'agent ne pourrait ni lire les achats ni décrire les médias des scripts | étapes ajoutées |
| 5 | Pas de filtre « All » ni de rappel pour les WebSocket | le temps réel (L4) pouvait manquer à la capture | rappel ajouté |
| 6 | Pas de note de l'heure de chaque action | relier une requête à un geste devient long | rappel ajouté |
| 7 | Dossier du dépôt « Projet Nirvana » dans la référence | le clone de Charles est « Impera Studio » | chemin corrigé |
| 8 | « Écris dans le fil Connexion Reveal » : ce fil n'existe plus | message perdu | « dans le chat du projet » |
| 9 | Rien sur Edge, le navigateur principal de Charles | doute inutile | Edge marche pareil (`F12`, Réseau, Exporter HAR) |
| 10 | Si le bot ne voit pas une page (ventes, statistiques), la référence disait de refaire l'étape avec le compte de Charles | une session de Charles dans une capture, contre la règle « session du bot, jamais la sienne » | on note seulement que le bot ne la voit pas : ventes et statistiques se lisent par l'API CRM (ADR 0050), pas par la session |

## Ce qui reste hors de la capture (à savoir)

- **Marquer lu et « en train d'écrire » (E6)** : ils passent d'eux-mêmes pendant la navigation ; rien à faire de plus.
- **Écrire les notes du modèle (E4b)** : volontairement absent, on ne touche pas la fiche de Messa dans Reveal sans demande de Charles.
- **Mass DM, feed, publication** (CR-08, CR-11) : pas dans cette capture ; une deuxième capture courte, plus tard, si Charles veut ces fonctions.
- **Export CSV du dashboard** : ce n'est pas la capture HAR mais il manque autant (noms de colonnes jamais vus) : il est dans la liste de Charles.
- **Deuxième capture** (10 min, un autre jour) : vérifie que les identifiants et les adresses ne changent pas. Toujours prévue.
- **Enregistreur de l'extension** (P1-01) : pas fait ; il remplacera la capture à la main pour les suivantes.

## Après la capture (qui fait quoi)

1. Charles dépose le `.anon.json` dans `.scratch/inbox/` de son clone et l'écrit dans le chat du projet.
2. Un fil lit le fichier sur son PC (dossier déjà approuvé), remplit `docs/reference/reveal-api-observed.md`, découpe les enregistrements de FakeReveal, réécrit les routes provisoires de FakeReveal (P1-02).
3. Décision B/C et spécification du connecteur (P1-03), puis `RevealApiConnector` contre la suite de contrat, puis la transmission de la session du bot par l'extension.
