# COF-01 Médias : un média offert n'est jamais revendu, un média de script n'est jamais gratuit
Statut : done
Phase : coffre (ADR 0145 § 2, avenant du 21/11/2026)
Dépend de : synchronisation du coffre (fait), scripts natifs et scripts en préparation (faits)
Branche : claude/project-thread-53kkgu
Propriétaire : Médias ; revue Scripts à branches (scripts), Bilan (base, contrats, connecteur)

## Objectif (1 phrase)

La règle de Charles « un média offert n'est jamais revendu, un média de script n'est jamais gratuit » est tenue par le code, pas par un prompt.

## Pourquoi maintenant

L'audit des tests du 21/11 a trouvé la règle écrite dans l'ADR 0145 § 2 mais codée nulle part : un média envoyé gratuitement pouvait être revendu par un script.

## À faire (liste vérifiable)

- [x] La synchronisation du coffre lit `sentForFree` de Reveal et garde la date de la première lecture (`media_platform_refs.sent_for_free_at`), jamais effacée.
- [x] `vaultOffered` (base) : marque de Reveal, ou fichier gardé par un dépôt gratuit non retiré.
- [x] Scripts natifs : manque `media_offered` sur une étape payante qui vend un média offert ; l'agent ne propose plus le script.
- [x] Scripts en préparation : manque `media_offered` sur une branche payante ; « prêt à copier » refusé ; libellé à l'écran.
- [x] `mediaInScript` (base) : l'archive d'un dépôt gratuit laisse de côté un média de script, et la fiche le dit.
- [x] Tests : unitaires (plan de synchro, manques, archive) et intégration (synchro sur FakeReveal, scripts natifs et préparés, archive).

## Critères d'acceptation

- Un média lu une fois comme offert le reste après une synchro qui ne le dit plus.
- Une étape offerte et un aperçu ne déclenchent rien ; une étape payante, si.
- Le Mass DM qui reprend un média de script ne le met pas dans son archive.

## Hors périmètre

- Les rôles de dossier (`vault_folder_role`) et leur écran : pas de nouvel écran sans le feu vert de Charles.
- Les sorties gratuites à venir (publication Telegram, Mass DM automatique) : elles appellent `mediaInScript` dans leur propre PR.

## Notes de session

- 21/11 : fait sur la branche du fil Médias. Ce que Reveal compte exactement dans `sentForFree` (aperçus d'un PPV payant ?) reste à voir à la première vraie lecture.
