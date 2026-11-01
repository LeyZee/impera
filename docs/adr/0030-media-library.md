# 0030. Médiathèque : un média, ses liaisons par plateforme, le coffre fait foi

Statut : accepted (Charles, 27/10 20h37, carte « J'accepte, vignette seule » ; texte précisé avant fusion à la relecture de Bilan, § 1, § 3 et § 5, sans changer la décision acceptée)
Date : 2026-10-27

## Contexte

L'agent ne vend que des étapes de scripts dont les bundles sont préparés dans Reveal (ADR 0018, P6-01). Pour raconter un média au fan, il lui faut une description fidèle de chaque média ; pour ne jamais lui remontrer un contenu, il faut savoir ce qu'il a déjà vu. Aujourd'hui :

- `media_assets`, `media_descriptions` et `media_sends` existent, mais un média n'a aucun lien avec son identifiant sur la plateforme : on ne sait pas dire « ce média du coffre Reveal est celui-ci » ;
- le port déclare `listVaultMedia` et `fetchMedia` (ADR 0018), sans adaptateur tant que la capture Reveal manque ;
- la description est une sortie du rôle `sense` qu'aucun humain ne peut corriger ni valider (P6-01 le demande) ;
- P6-01 laisse ouverte la question « récupération et conservation des médias » et demande une ADR avant le code.

Desirely, l'outil concurrent étudié le 27/10 (centre d'aide, 58 articles), règle ces points ainsi : une médiathèque par créatrice remplie seulement par synchronisation depuis la plateforme (jamais par téléversement), un média logique relié à son original sur chaque plateforme, des descriptions générées puis modifiables, une description d'étape obligatoire qui « fait foi » sur la scène, et une règle « un média déjà vu exclut le script ». La comparaison complète est dans `docs/reference/desirely-analysis.md`.

## Décision

1. **Un média logique, des liaisons par plateforme.** `media_assets` reste le média : un fichier lu, une empreinte `sha256` unique par créatrice. Une nouvelle table `media_platform_refs` relie un original du coffre d'un compte à ce média : `creator_id` (avec `tenantPolicy` et FORCE RLS, comme les autres tables), `platform_account_id`, `platform_media_id`, unique sur `(platform_account_id, platform_media_id)`, `media_asset_id`, `folder_ref`, `folder_name`, `last_synced_at`, `removed_at`. Le cœur ne connaît que la liaison, jamais la forme Reveal (ADR 0003).
   - **La liaison existe avant son média.** `listVaultMedia` donne des identifiants sans fichier : la liaison est créée à la synchronisation avec `media_asset_id` vide, et reçoit son média au premier `fetchMedia`, quand l'empreinte est connue. Une liaison sans média n'est pas proposable.
   - **Deux plateformes ne se rejoignent pas toutes seules.** Reveal et OnlyFans réencodent : la même photo y a deux empreintes, donc d'abord deux médias. Deux liaisons ne rejoignent un même média que par un rattachement fait par un humain dans l'écran de la médiathèque ; une reconnaissance automatique (empreinte perceptuelle) demandera sa propre ADR. Tant qu'un humain ne les a pas rattachées, chaque média garde ses descriptions et son « vu ».

2. **Le coffre de la plateforme fait foi.** Nirvana ne téléverse rien vers une plateforme et n'a pas de dossier à lui : la médiathèque est le reflet du coffre, dossiers compris (les suffixes Jour et Nuit se lisent dans le nom du dossier, P6-01). La synchronisation (`media.sync`, job rejouable) lit `listVaultMedia`, crée ou met à jour les liaisons par `platform_media_id`, et marque `removed_at` quand un média disparaît du coffre, sans jamais supprimer le média ni ses descriptions. C'est une lecture : la garde d'écriture de l'ADR 0018 n'est pas concernée.

3. **Description en deux temps, la parole humaine gagne.** Quand une liaison reçoit un nouveau média, le rôle `sense` le décrit (images, vidéos par images clés et transcription, `media.ts`), en français, une fois par empreinte et par version du descripteur (`descriptionKey`). Un humain (propriétaire ou créatrice) peut corriger la description et la valider : la correction est une nouvelle ligne (`media_descriptions` reste en ajout seul) avec `author` humain, `validated_by` qui référence un membre de l'agence (`team_members.id`, jamais un texte libre), `validated_at`, et un champ libre `creator_note` (le ressenti de la créatrice, P6-01). La validation vise une ligne de description précise. L'agent lit la description validée la plus récente par `validated_at` (pas par `created_at`), sinon rien : un média sans description validée rend son script non proposable (P6-01). Changer de modèle de vision redécrit les médias non validés, jamais un média qu'un humain a validé.

4. **Fichiers : on garde le minimum.** Le fichier original est lu par `fetchMedia` le temps de la description, puis effacé. On garde l'empreinte, la durée, le type et une vignette réduite pour l'écran (affichée floutée par défaut) : après l'effacement, `storage_key` désigne la vignette. Pour redécrire, on relit le fichier sur la plateforme. Si Reveal ne permet pas de télécharger les originaux, le repli est le dépôt manuel du fichier par le propriétaire, rattaché à une liaison existante du coffre par l'écran ; le fichier déposé suit la même règle d'effacement.

5. **« Vu par ce fan » se lit par média, depuis les messages de la plateforme.** Un média gratuit est vu dès son envoi, un média payant seulement une fois débloqué.
   - `media_sends` est une **projection des messages de la plateforme ingérés**, entrants et sortants, envois faits à la main par un chatteur dans Reveal compris ; on n'y écrit jamais sur notre seule intention d'envoyer. L'écriture se fait à l'ingestion, dans le module `conversations`, par la jointure `(platform_account_id, identifiant du média porté par le message)` → `media_platform_refs` → `media_asset_id`. `media_sends` reçoit `unlocked_at` pour le déblocage confirmé par la plateforme, jamais sur la parole du fan.
   - Un message dont le média n'a pas de liaison est noté comme média inconnu, jamais ignoré en silence.
   - Cette projection complète l'indicateur « déjà envoyé » par script de l'ADR 0018 (§ 5) sans le remplacer : ce n'est pas un historique parallèle, puisqu'elle se reconstruit depuis les messages de la plateforme. En cas de désaccord entre les deux, on exclut (fail-closed) : un script est écarté s'il est « déjà envoyé » selon Reveal ou si un de ses médias est « vu » selon les messages.

## Conséquences

Positives :
- La même règle sert Reveal aujourd'hui et OnlyFans demain : un script est proposable sur un compte seulement si chacun de ses médias y a une liaison avec un média décrit et validé.
- L'agent ne décrit jamais un média de son imagination, et une correction humaine n'est jamais écrasée par une nouvelle génération.
- Rien d'intime ne reste chez nous au-delà d'une vignette.

Négatives :
- Une redescription demande un nouvel accès à la plateforme, donc une session valide.
- Les descriptions coûtent des appels de vision : elles entrent dans le plafond du jour, et une première synchronisation d'un gros coffre se fait par lots.
- Le rattachement de deux plateformes est un geste humain, média par média, tant qu'aucune reconnaissance automatique n'est décidée.
- `media_platform_refs`, les colonnes de validation et `unlocked_at` demandent une migration (numéro attribué par Bilan).

À surveiller :
- Les signatures de `listVaultMedia` (pagination, dossiers) et de `fetchMedia` (URL temporaire ou flux) se fixent d'après la capture.
- L'identifiant porté par un média dans un message (`ExternalMessage.media[].ref`) doit être l'identifiant du média du coffre, et non un identifiant de pièce jointe propre au message ; la capture le dira. Sinon, la jointure du § 5 demande une autre clé, à décider avant le code.
- La durée de conservation de la vignette, si Charles en veut une autre que celle des médias de la créatrice (`rights`).

## Alternatives rejetées

- **Téléverser les médias dans Nirvana puis vers Reveal.** Nirvana deviendrait une seconde source de vérité du coffre, et chaque envoi passerait par une écriture de plus derrière la garde ; Desirely y a renoncé pour la même raison.
- **Rapprocher deux plateformes par l'empreinte `sha256`.** Elle ne reconnaît que des octets identiques, et les plateformes réencodent : le rapprochement serait presque toujours faux négatif. Il reste humain jusqu'à une ADR sur l'empreinte perceptuelle.
- **Écrire `media_sends` au moment où l'agent envoie.** Cela tiendrait un historique de notre intention, qui diverge dès qu'un chatteur envoie à la main ou qu'un envoi échoue (ADR 0018, § 5).
- **Garder les originaux chiffrés en stockage objet.** Utile pour redécrire sans session, mais c'est un stock de contenus intimes à protéger pour un gain faible : la plateforme les garde déjà (choix de Charles, 27/10).
