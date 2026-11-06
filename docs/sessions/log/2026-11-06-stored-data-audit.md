# 2026-11-06 — Ce qui est gardé en base : jobs abandonnés, ffmpeg, `last_error`

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, après l'audit de ce qui est gardé en base (points 1 à 3 validés ; points 4 et 5 attendent Charles)

## Fait

- **Point 1, jobs abandonnés** : Graphile garde sans fin un job qui a épuisé ses tentatives, avec sa charge utile. Celle de `conversation.record_facts` contient la note libre d'un chatteur sur un fan.
  - `purgeDeadJobs` (`apps/api/src/dead-jobs.ts`) supprime les jobs abandonnés depuis plus de 30 jours, jamais un job verrouillé.
  - Chaque worker l'appelle au démarrage puis toutes les heures, comme pour les verrous orphelins.
  - Testé en intégration.
  - La règle est ajoutée à `operations.md`.
- **Point 2, ffmpeg et ffprobe** : un échec ne dit plus que le programme, le code de sortie ou le signal, et les dernières lignes d'erreur de ffmpeg.
  - Il ne cite plus la commande, ni le vidage de l'entrée (`Input #0 … from '<chemin>'` et ses lignes indentées), qui contient les métadonnées du fichier.
  - `killed` et `signal` restent.
  - Un test vérifie qu'un fichier titré n'apparaît pas dans l'erreur.
- **Point 3, `last_error` et journaux** : un message d'erreur qui ne vient pas de la base tient maintenant sur une ligne de 300 caractères au plus (`storableError`).
  - Une erreur de base garde sa requête sans valeurs et son SQLSTATE.

## Reste

- **Point 1 (a), non fait** : la note n'est pas dans `conversation_events`.
  - `takeover_ended` ne porte que `conversationId` et `userId` (`commands.ts`, `release`).
  - Remplacer le texte par une référence changerait le contrat du job et l'événement, sans doute avec une migration.
  - Le coordinateur est prévenu ; c'est à lui de trancher.
- Points 4 et 5 (nom de scène dans `audit_log`, raison d'un coupe-circuit) : en attente de Charles.

## Découvertes

- Aucune.
