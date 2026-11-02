# SEC-02 Deuxième facteur pour tous les comptes
Statut : done
Phase : exploitation
Dépend de : ADR 0046, SEC-01
Branche : claude/project-thread-8fl2b1 (fil « Auditer et sécuriser Nirvana »)

## Objectif (1 phrase)

Aucun compte n'ouvre le dashboard avec son seul mot de passe : un code TOTP est exigé, activé à la première connexion (ADR 0046 § 1 à 4).

## Contexte à lire (fichiers précis)

- ADR 0046, ADR 0016 (connexion récente), EQ-10 (liens d'invitation et de réinitialisation).
- `apps/api/src/auth.ts`, `apps/api/src/invitation-links.ts`, `packages/db/src/schema/auth.ts`, `apps/web/src/auth/`.

## À faire (liste vérifiable)

- [x] Migration 0061 (attribuée par Bilan) générée par drizzle-kit : table `two_factor`, colonne `user.two_factor_enabled`, hors RLS comme le reste de l'authentification.
- [x] Plugin `two-factor` de Better Auth : émetteur « Nirvana », secret et codes de secours chiffrés, appareil de confiance 30 jours, verrouillage du code après 10 échecs.
- [x] Routes exposées sous `/v1/auth/two-factor/*` : celles du parcours seulement (activer, vérifier un code, vérifier un code de secours ; regénérer les codes passe à SEC-04), en français, sans jeton dans le corps.
- [x] Un compte sans deuxième facteur actif n'ouvre que l'écran d'activation et `/v1/me` : toute autre route répond 403 `second_factor_forbidden`.
- [x] La confirmation avant une action sensible demande le mot de passe et le code, appareil de confiance ou non : une route vérifie les deux puis horodate la session, et `recentLogin` lit cet horodatage, plus `createdAt` (sinon une reconnexion sans code depuis un appareil de confiance passerait). Colonne éventuelle : migration 0062, à demander à Bilan. Créer ou élargir un accès d'agent (`mcp_grant`, ADR 0026) rejoint la liste.
- [x] Fermer toutes les sessions (soi, ou un membre par le propriétaire), le lien de réinitialisation, la remise à zéro du deuxième facteur et le départ (EQ-14) suppriment aussi les appareils de confiance (lignes `trust-device-…` de `verification`).
- [x] Le lien de réinitialisation (EQ-10) remet aussi le deuxième facteur à zéro ; une commande d’exploitation sur le serveur le fait pour le propriétaire, auditée.
- [x] Mot de passe connu des fuites refusé à sa création (contrôle Pwned Passwords en k-anonymat dans `apps/api/src/password-breaches.ts`, pas le plugin : les mots de passe se choisissent par les liens d'invitation, hors Better Auth). Le plugin refuse quand l'API ne répond pas : sortie vers `api.pwnedpasswords.com` à autoriser en production, et l'écran dit « réessaie plus tard », jamais une erreur brute.
- [x] Playbook : changer le secret de Better Auth oblige chaque compte à réactiver son deuxième facteur (secret du code, codes de secours et cookie d'appareil de confiance en dépendent).
- [x] Écrans : activation (clé à recopier ou ouverte d'un geste sur téléphone ; QR code reporté, bibliothèque en quarantaine), saisie du code à la connexion, codes de secours montrés une fois.

## Critères d'acceptation (tests, commandes, comportements observables)

- Intégration : mot de passe juste sans code → aucune session ; code juste → session ; code de secours utilisable une seule fois ; compte sans facteur → 403 hors activation ; appareil de confiance → pas de code à la connexion, code exigé pour une action sensible même juste après une reconnexion ; fermer toutes les sessions → l'appareil de confiance redemande le code.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Limites par compte et adresse, durée absolue (SEC-03) ; Réglages › Sécurité et alertes (SEC-04) ; passkeys.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- `/v1/me` répond lui aussi 403 `second_factor_forbidden` tant que le code n'est pas activé : l'application lit ce refus et n'ouvre que l'écran d'activation.
- La confirmation (`POST /v1/auth/reauthenticate`) ne crée pas de session : elle horodate `session.reauthenticated_at` (migration 0061, pas de 0062). Sa limite par compte est de 10 essais par 10 minutes : avec les bornes de la connexion (10 par 15 minutes), les deux limiteurs partageraient leurs compteurs et le serveur refuserait de démarrer.
- La connexion ne trace `auth.login` qu'une fois le code donné (ou sur un appareil de confiance).
- Reste pour SEC-04 : regénérer les codes de secours depuis Réglages › Sécurité. QR code quand une bibliothèque sort de quarantaine.
