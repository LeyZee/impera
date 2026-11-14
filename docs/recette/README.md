# Recette complète d'Impera

Plan écrit le 06/11/2026, à jouer **après la fusion de #614 (Médias, Créatrices › Scripts) et de #615 (Équipe, rapports de shift déclarés, ADR 0073)**, sur `main` à jour. Demande de Charles (06/11, 16h50) : tester tous les écrans, sous-onglets, workflows et fonctionnalités, en large et en profondeur, anticiper ce qui peut bloquer, corriger, et préparer le branchement des clés (Reveal, IA) pour qu'il y ait le moins de bugs possible le jour où elles arrivent.

La recette précédente (05/11, 131 constats, tous traités) a montré la méthode. Celle-ci la reprend, avec un lot par zone de propriété, et ajoute trois choses : les parcours de bout en bout entre zones, le comportement sans clé et un mode simulé à construire pour jouer l'agent sans clé.

## Les fichiers

| Fichier | Pour qui | Contenu |
|---|---|---|
| [inventaire.md](inventaire.md) | tous les lots | chaque écran, sous-onglet et onglet, par rôle, avec son adresse |
| [lot-bilan.md](lot-bilan.md) | fil Bilan | API, base, worker, jobs, connecteurs, sécurité, clés |
| [lot-extension.md](lot-extension.md) | fil Extension | apps/web (shell, navigation, écrans transverses), PWA, design, extension Chrome |
| [lot-agent.md](lot-agent.md) | fil Agent | agent, gardes, supervision, Suivi, persona, playground, évals |
| [lot-equipe.md](lot-equipe.md) | fil Équipe | membres, planning, rapports de shift, paie, factures, commissions |
| [lot-medias.md](lot-medias.md) | fil Médias | contenu, dépôts, scripts, structures, médiathèque, idées |
| [parcours-transverses.md](parcours-transverses.md) | coordinateur | les workflows qui traversent plusieurs zones, à jouer par plusieurs lots |
| [preparation-cles.md](preparation-cles.md) | Bilan, Agent | ce qui est prêt pour chaque clé, ce qui manque, le mode simulé, l'ordre du jour J |
| [capture-reveal.md](capture-reveal.md) | Charles, API Reveal | relecture du dispositif de capture de l'écran Reveal et ce qui manquait |
| [charles-sur-reveal.md](charles-sur-reveal.md) | Charles | la liste courte de ce qu'il teste lui-même sur Reveal |

## Règles de la recette (pour chaque agent)

1. **Rien de réel.** Aucune vraie clé, aucun appel à Reveal, xAI, Google, Mistral, ElevenLabs, Telegram ou Instagram. Aucun pilotage de navigateur sur Instagram. Pas de déploiement. Toutes les données sont inventées et évidemment fausses (dépôt public, ADR 0010) : créatrices « Lina Test », « Maya Démo » ; fans « fan_alpha », « fan_beta » ; chatteurs « Chatteur Un », « Manager Un » ; adresses en `@recette.test`. Le pourcentage réel de l'agence n'apparaît nulle part : on prend 40 % dans les données de recette.
2. **Une pile par agent.** Chaque agent a sa base (`impera_rN`), son API avec worker en ligne (`IMPERA_INLINE_WORKER=1`, port 3100+N) et son CRM Vite (port 5200+N), dans `.scratch/recette/` (ignoré par git). Pièges connus : le rôle `nirvana_admin` doit avoir BYPASSRLS, et le `.env` de la pile doit porter `DATABASE_SERVICE_URL` (rôle `impera_service`, ADR 0087 : `db:migrate` le crée et lui donne ce mot de passe), sinon l'API ne démarre pas ; Playwright est déjà installé dans le conteneur, on ne le réinstalle pas ; le propriétaire et les managers doivent activer le second facteur (ADR 0046) : le script de connexion calcule le code TOTP.
3. **Tous les rôles, tous les formats.** Chaque écran se joue avec chaque rôle qui l'ouvre (inventaire), en Nuit et en Jour, sur ordinateur (1440 px) et sur téléphone (390 px), plus une passe « mouvement réduit ». Un écran qu'un rôle ne doit pas ouvrir se teste aussi : l'adresse collée doit le renvoyer chez lui avec « Cette page n’est pas dans ton espace. », et l'API doit répondre 403.
4. **Chaque état.** Vide, chargement, erreur du serveur (API coupée), hors ligne, données longues (noms de 60 caractères, émojis, RTL), beaucoup de données (200 lignes), double clic, retour arrière, rechargement au milieu d'un formulaire, deux onglets ouverts sur le même objet.
5. **Ce qui ne marche qu'avec une clé** se joue deux fois : sans clé (l'écran doit dire calmement ce qui manque, rien ne plante, rien n'est envoyé) et en mode simulé quand il existera ([preparation-cles.md](preparation-cles.md)).
6. **Règles de Charles sur le design** (à vérifier sur chaque écran) : aucune barre colorée à gauche, aucun contrôle natif (cases, listes, dates) ; rouge seulement pour les urgences, ambre pour les avertissements ; dates « 28/03/2027 » ; modales avec titre, explication, champs empilés, actions au pied ; bulles envoyées mauve désaturé ; sur téléphone, chatteur et créatrice sans « Plus ».
7. **Français partout**, termes du glossaire (`docs/glossary.md`), aucune trace technique à l'écran (code d'erreur brut, « undefined », pile), console du navigateur propre.

## Format d'un constat

Un constat par ligne dans le rapport du lot, sous `/mnt/project-files/recette/2026-11-07/<lot>/` (hors git) :

```
| ID | Gravité | Écran ou route | Rôle | Étapes | Attendu | Obtenu | Preuve | Cause probable | Correction proposée |
```

- IDs : `BIL-nn`, `EXT-nn`, `AGT-nn`, `EQP-nn`, `MED-nn`, `TRV-nn` (parcours transverses).
- Gravité : **bloquant** (un workflow réel est coupé ou une donnée est fausse ou fuit), **majeur** (faux à l'écran, contournable), **mineur**, **cosmétique**, **amélioration**.
- Preuve : capture (Nuit et Jour quand c'est visuel), requête et réponse (sans secret), ou test qui échoue.
- Un constat sur une zone qui n'est pas la sienne va au fil propriétaire, pas dans sa PR.

## Corriger

Chaque lot corrige ce qui est dans sa zone, dans des PR courtes (une par famille de constats), avec un test qui échouait avant. Une grosse PR doit fusionner vite : chaque fusion de `main` la remet en conflit (leçon du 05/11). Les écrans modifiés repassent par des captures validées par Charles avant fusion. Un constat qui demande une décision métier (argent, règles de vente, droits) remonte au coordinateur, qui la pose à Charles avec une recommandation.

## Ordre de lancement proposé

1. **Bilan d'abord, 30 minutes avant les autres** : il prépare et publie l'outillage commun (script de pile, script de connexion avec TOTP, jeu de données de recette) dans `.scratch/recette/` du conteneur de chaque fil, ou le décrit pour que chacun le refasse. Voir la fiche proposée `docs/sessions/tasks/PROPOSED-recette-sandbox.md` et le mode d'emploi du bac à sable [bac-a-sable.md](bac-a-sable.md).
2. **Extension, Équipe, Médias, Agent en parallèle**, chacun sur sa pile.
3. **Parcours transverses** en dernier, joués par le lot qui possède la première étape, avec les autres en relecture.
4. **Synthèse** par le coordinateur : un tableau des bloquants et majeurs, les questions pour Charles, la liste de ce qu'il doit voir.

## Déjà connu avant de commencer

- Le connecteur de messagerie Reveal n'existe pas encore (la capture n'a pas été faite) : la boucle « un fan écrit, l'agent propose, un humain envoie » ne se joue aujourd'hui que dans les tests, avec `FakeConnector`. Aucun écran ne peut la montrer sur une pile de recette. C'est le premier manque à combler : [preparation-cles.md](preparation-cles.md).
- La pile de dev ne branche aucun connecteur (registre vide dans `apps/api/src/composition-root.ts`) et aucun faux fournisseur d'IA : sans clé, l'agent retient chaque brouillon (`llm_unavailable`).
- L'extension ne transmet pas encore la session du membre « bot » à l'API : la route `POST /v1/connector/sessions` existe, aucun écran ni code de l'extension ne l'appelle.
- Aucun jeu de données de recette n'existe dans le dépôt : chaque agent le fabrique par l'API. La fiche proposée en fait un script.
