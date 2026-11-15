# Module `playground`

**Rôle.** L'API de l'écran Entraîner > Playground (fiche P3-06), sous `/v1/playground`. Elle pilote le moteur de calibrage de P3-05 : parler au bot comme un fan, noter, corriger ou rejeter chaque réponse, mettre le fan en situation, rejouer et comparer. Rien n'est jamais envoyé à un fan.

**Peut dépendre de.** agent, packages/llm

**Règles propres.**

- Une session par utilisateur, en mémoire : un redémarrage la vide.
- La persona jouée (recette PRO-21) : la persona fictive (`PLAYGROUND_PERSONA_PATH`) au départ, ou une version d'une créatrice, active ou pas, choisie par `POST /v1/playground/persona` (`{ kind: 'invented' }` ou `{ kind: 'version', creatorId, versionId }`), lue par le port `personaVersion` (`persona.versions.version`) comme ses brouillons lisent sa version active. Le choix recommence la conversation ; refusé pendant une réponse (409 `answer_in_progress_conflict`) ; version inconnue d'elle : 404 `playground_persona_not_found`, et la session reste telle quelle. L'état dit `persona.played` ; les notes qui suivent vont à cette créatrice. L'activation reste celle de `persona` (propriétaire, connexion récente).
- Les notes vont au magasin d'`agent`, en JSONL hors dépôt (`IMPERA_TRAINING_DIR`), tant qu'il n'y a pas de table. Le taux est commun à tous, puisqu'il mesure le bot.
- Les libellés des gardes, des pièges et des raisons sont écrits ici, en français : l'écran les affiche tels quels.
- La note de désir (P3-12) est lue à chaque message du fan, qu'elle bouge ou non (`desireRead` du cœur) : la réponse et l'état la donnent avec chaque signal et ses points (`desireSignalPoints`), et les deux seuils de sa persona (`desireThresholds`). Chaque tour porte son heure sur l'horloge simulée : la vitesse de réponse du fan compte comme en prod dès que l'horloge a bougé entre son message à elle et celui du fan (avancer d'une minute simule un fan rapide, de deux heures un fan lent) ; horloge immobile, elle n'est pas mesurée, sinon chaque message vaudrait une réponse rapide. La réponse dit aussi ce qu'a décidé le curseur et pourquoi la règle a refusé une offre (libellés dans `domain/labels.ts`).
- Un média saisi (type plus quelques mots) est complété sans rien supposer : intensité non visible, aucune anatomie. Ses alertes servent à tester le relais humain.
- Sans modèle de voix joignable, `llm_unavailable` en 503.
- Les commandes du terminal (`pnpm playground`) réutilisent la session, les préréglages et la persona de ce module.
- `POST /v1/alerts/test` (Réglages › Alertes, P4-01) est servi ici, mais lit la phrase avec la version active de la persona de la créatrice que le corps nomme (`creatorId`, une des créatrices de l'alerte ; recette 28/10, M13), par le port `activePersona`, jamais avec la persona du playground. Sans version active, les mots-clés sont lus et `reason` dit en français pourquoi la phrase ne l'est pas.

## Structure

- `domain/` : préréglages de fans fictifs, libellés, complétion d'un média saisi.
- `application/` : le port `PlaygroundEngine`, ses erreurs, une session par utilisateur.
- `infra/` : session P3-05, moteur sur la passerelle, lecture de la persona, routes Fastify.
- `index.ts` : `createPlaygroundModule`, `startPlaygroundModule` et ce que le terminal réutilise.
