# SEC-02 Deuxième facteur pour tous les comptes
Statut : todo
Phase : exploitation
Dépend de : ADR 0046, SEC-01
Branche : claude/project-thread-8fl2b1 (fil « Auditer et sécuriser Nirvana »)

## Objectif (1 phrase)

Aucun compte n'ouvre le dashboard avec son seul mot de passe : un code TOTP est exigé, activé à la première connexion (ADR 0046 § 1 à 4).

## Contexte à lire (fichiers précis)

- ADR 0046, ADR 0016 (connexion récente), EQ-10 (liens d'invitation et de réinitialisation).
- `apps/api/src/auth.ts`, `apps/api/src/invitation-links.ts`, `packages/db/src/schema/auth.ts`, `apps/web/src/auth/`.

## À faire (liste vérifiable)

- [ ] Migration 0061 (attribuée par Bilan) générée par drizzle-kit : table `two_factor`, colonne `user.two_factor_enabled`, hors RLS comme le reste de l'authentification.
- [ ] Plugin `two-factor` de Better Auth : émetteur « Nirvana », secret et codes de secours chiffrés, appareil de confiance 30 jours, verrouillage du code après 10 échecs.
- [ ] Routes exposées sous `/v1/auth/two-factor/*` : celles du parcours seulement (activer, vérifier un code, vérifier un code de secours, regénérer les codes), en français, sans jeton dans le corps.
- [ ] Un compte sans deuxième facteur actif n'ouvre que l'écran d'activation et `/v1/me` : toute autre route répond 403 `second_factor_forbidden`.
- [ ] La confirmation avant une action sensible demande le mot de passe et le code, appareil de confiance ou non.
- [ ] Le lien de réinitialisation (EQ-10) remet aussi le deuxième facteur à zéro ; `pnpm ops:reset-second-factor` pour le propriétaire, audité.
- [ ] Mot de passe connu des fuites refusé à sa création (plugin `haveibeenpwned`).
- [ ] Écrans : activation (clé à recopier, QR code quand la bibliothèque sort de quarantaine), saisie du code à la connexion, codes de secours montrés une fois.

## Critères d'acceptation (tests, commandes, comportements observables)

- Intégration : mot de passe juste sans code → aucune session ; code juste → session ; code de secours utilisable une seule fois ; compte sans facteur → 403 hors activation ; appareil de confiance → pas de code à la connexion, code exigé pour une action sensible.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Limites par compte et adresse, durée absolue (SEC-03) ; Réglages › Sécurité et alertes (SEC-04) ; passkeys.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)
