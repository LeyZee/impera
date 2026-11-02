# SEC-01 Audit de sécurité : premiers correctifs
Statut : in_progress
Phase : exploitation
Dépend de : —
Branche : claude/project-thread-8fl2b1 (fil « Auditer et sécuriser Nirvana »)

## Objectif (1 phrase)

Corriger, sans changer le métier, les points de l'audit de sécurité du 02/11/2026 qui ne demandent pas de décision de Charles.

## Contexte à lire (fichiers précis)

- `docs/conventions/security.md`, `docs/architecture/threat-model.md`.
- Le rapport d'audit lui-même est gardé hors du dépôt (dépôt public) ; les points qui demandent une décision passent par l'ADR 0046.

## À faire (liste vérifiable)

- [x] M4 : ffmpeg ne lit d'un fichier de fan que les conteneurs qu'envoie un téléphone, n'ouvre que ce fichier, et chaque appel est tué passé son délai.
- [x] M1 : activer une version de la persona exige une connexion de moins de 10 minutes ; l'écran Persona redemande le mot de passe.
- [x] B1 : `Strict-Transport-Security` et `Permissions-Policy` sur les pages du dashboard, vérifiés par le job `images`.
- [x] M3 (en partie) : l'extension n'atteint Reveal qu'en HTTPS.

## Critères d'acceptation (tests, commandes, comportements observables)

- `ffmpeg-media-tools.test.ts` : un format hors liste est refusé, un appel trop long est tué, une playlist ne passe pas.
- `persona-versions.integration.test.ts` : une session de plus de 10 minutes reçoit 403 `reauthentication_forbidden` à l'activation, rien n'est activé.
- `PersonaSection.test.tsx` : la demande de mot de passe s'affiche à ce refus.
- `pnpm check` et la CI verts, job `images` compris.

## Hors périmètre

- Deuxième facteur, verrouillage de compte, durée absolue des sessions, alertes de sécurité : ADR 0046, puis leurs lots.
- Jeton d'extension par appareil : ADR à écrire avec le fil Reveal, avant la capture de session.
- Épinglage des actions de CI et des images par empreinte, montée des dépendances transitives (quarantaine de 14 jours).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- ffmpeg 6.1 refuse déjà une playlist HLS sans extension ; la liste blanche le garantit de notre côté, quelle que soit la version.
