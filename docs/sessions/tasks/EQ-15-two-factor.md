# EQ-15 Double authentification pour le propriétaire et les managers
Statut : todo (ID validé par Charles le 27/10/2026, 15h11 : « je les veux tous »)
Phase : équipe (ADR 0023, ADR 0024)
Dépend de : EQ-01 (rôle d'équipe), EQ-10 (liens de réinitialisation), EQ-11 (shell par rôle)
Branche : task/eq-15-two-factor

## Objectif
Un compte qui valide de l'argent (propriétaire, manager) ne s'ouvre pas avec un mot de passe seul : il demande aussi un code à usage unique, et les gestes les plus lourds le redemandent.

## Contexte à lire
`apps/api/src/auth.ts` (Better Auth 1.7, sessions de 12 h), `docs/conventions/security.md`, `docs/architecture/threat-model.md`, ADR 0024 (§ Rôles et scopes), EQ-05 (« payé »), EQ-06 (avoirs), EQ-10 (lien de réinitialisation), EQ-14 (départ). Better Auth fournit un module de double authentification (`two-factor` : codes TOTP d'une application d'authentification, codes de secours) ; Nirvana n'envoie ni e-mail ni SMS, donc pas de code par e-mail.

## À faire
- [ ] Module `two-factor` de Better Auth branché, tables par le propriétaire de `packages/db` (migration à part). Le secret TOTP est chiffré par Better Auth avec `AUTH_SECRET`, jamais en clair ni dans un log ; changer ce secret oblige chacun à réactiver sa double authentification, et le runbook le dit.
- [ ] Le module n'impose rien : l'obligation est une règle de notre `requireRole` (`twoFactorEnabled`), testée. `/v1/me` dit où en est le compte (`twoFactor` : `required` | `enabled` | `optional`, contrat par le propriétaire de `packages/contracts`) pour que la garde d'EQ-11 mène à l'activation, en plus du 403 du serveur.
- [ ] **Obligatoire** pour le propriétaire et pour tout manager : tant qu'elle n'est pas activée, la connexion mène à l'écran d'activation (code QR, saisie d'un premier code, dix codes de secours montrés une seule fois) et à rien d'autre. **Facultative** pour un chatteur, qui l'active dans Moi.
- [ ] **Gestes sensibles** : marquer une paie « payée », changer un taux ou un préréglage de commission, émettre un avoir, valider un départ (EQ-14), ouvrir « Voir comme » (EQ-19) redemandent un code si le dernier date de plus d'un délai réglé par le propriétaire. La date de la dernière vérification est gardée par session (une colonne sur `session`, dans la migration de cette fiche, que Better Auth ne garde pas) ; elle remplace `createRequireRecentLogin` (10 min depuis l'ouverture de la session), clés IA comprises. La règle est dans le serveur ; l'écran ne fait que demander le code.
- [ ] **Appareil perdu** : pour un manager ou un chatteur, le lien de réinitialisation d'EQ-10 remet aussi la double authentification à zéro et révoque les sessions ; pour le propriétaire, ses codes de secours, sinon une procédure écrite dans `docs/runbooks/` qui se fait sur le serveur, jamais depuis l'application.
- [ ] « Se souvenir de cet appareil » : désactivé par défaut pour le propriétaire et les managers ; réglage du propriétaire.
- [ ] La vérification du code a deux limiteurs, comme la connexion : par adresse IP et par compte ; `audit_log` pour l'activation, la désactivation, chaque code de secours utilisé et chaque remise à zéro.
- [ ] Écrans sur la mise en page de `SignInPage` (`autocomplete="one-time-code"`, `inputmode="numeric"`), textes en français, design system, aucune durée en dur.

## Critères d'acceptation
- Tests : un manager sans double authentification ne lit aucune route de l'équipe avant de l'avoir activée ; un code faux ou rejoué est refusé ; un code de secours ne sert qu'une fois ; une rafale de codes est bloquée par le limiteur ; « payé » sans code récent répond 403 avec un motif que l'écran sait lire ; une réinitialisation par lien remet la double authentification à zéro et ferme les sessions ; un manager repassé chatteur garde sa double authentification.
- Le secret TOTP n'apparaît dans aucun log ni aucune réponse après l'activation.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Clés d'accès (passkeys), codes par e-mail ou SMS, authentification unique (SSO).

## Notes de session
