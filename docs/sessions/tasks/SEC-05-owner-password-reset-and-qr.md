# SEC-05 Mot de passe oublié (Telegram, puis e-mail) et QR code de la validation en deux étapes
Statut : todo (ADR 0068 acceptée par Charles le 05/11/2026, 18 h 13)
Phase : exploitation
Dépend de : ADR 0068, ADR 0046, ADR 0020 (bot de l'agence), EQ-10 (liens d'invitation et de réinitialisation)
Branche : claude/project-thread-a8l1w6 (fil Bilan)
Propriétaires : Bilan (auth, telegram, migration 0114 attribuée par le coordinateur) ; Extension écrit les écrans (QR, « Mot de passe oublié » de la page de connexion, page d'arrivée du lien par `LinkPage` et `NewPasswordPage`, Réglages › Telegram) ; QR en SVG en ligne, sombre sur fond blanc fixe avec une marge de 4 modules, même en Nuit ; sur téléphone, le bouton `otpauth` et la clé avant le QR

## Objectif (1 phrase)

Le propriétaire retrouve l'accès sans terminal, par un lien reçu en privé sur Telegram, et chacun active son deuxième facteur en scannant un QR code dessiné dans le CRM.

## Contexte à lire (fichiers précis)

- ADR 0068 (tout), ADR 0046 § 2, ADR 0020, ADR 0016.
- `apps/api/src/invitation-links.ts` (liens EQ-10 : empreinte seule, usage unique ; leur réinitialisation remet aussi le deuxième facteur à zéro, celle-ci jamais), `apps/api/src/auth.ts`, `apps/web/src/auth/SecondFactorPage.tsx`, module `telegram`.

## À faire (liste vérifiable)

Lot 1 : QR code
- [ ] QR de l'adresse `otpauth` dessiné dans le navigateur, à côté de la clé ; encodeur dans le dépôt ou bibliothèque ancienne en quarantaine de 14 jours ; aucun appel externe ; disparaît après confirmation.

Lot 2 : liaison Telegram privée (migration 0114)
- [ ] Réglages › Telegram, connexion récente exigée : code à usage unique, 10 minutes, à envoyer au bot par `/start <code>` ; seule l'empreinte du code est gardée.
- [ ] Le bot garde l'identifiant du chat privé du compte, en rôle admin, pour ce seul usage ; délier possible ; audit.

Lot 3 : mot de passe oublié
- [ ] Lien « Mot de passe oublié » sur la page de connexion ; réponse identique et de même durée que le compte existe ou non ; une demande par compte toutes les 5 minutes, plus une limite par adresse.
- [ ] Lien à usage unique, 15 minutes, empreinte seule ; envoyé en privé par le bot (jamais un montant, un nom de créatrice ni une clé) ; le nouveau mot de passe ferme toutes les sessions ; le deuxième facteur reste demandé et n'est jamais remis à zéro par ce lien.
- [ ] La page dit toujours la même phrase, canal lié ou non, compte connu ou non (même code HTTP, même corps) : « Si cette adresse a un compte relié à Telegram, le lien vient d'y partir ; il vaut 15 minutes. Sinon, demande à un autre propriétaire. » La commande d'exploitation est dans /aide, jamais sur cette page.
- [ ] Audit de chaque demande, envoi et réinitialisation, sans le lien.

Plus tard (décision à part) : e-mail par un service d'envoi, clé saisie dans le CRM ; e-mails au design system, beaux et hiérarchisés (Charles, 05/11), captures avant fusion.

## Critères d'acceptation (tests, commandes, comportements observables)

- Intégration : même réponse pour un compte connu et inconnu ; lien périmé ou rejoué refusé ; sessions fermées ; code à 6 chiffres encore demandé ; code de liaison rejoué refusé ; aucun lien ni code dans les logs.
- Captures Nuit et Jour, téléphone et ordinateur, du QR et de la page de connexion, montrées à Charles avant fusion.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Le choix du service d'e-mail ; la remise à zéro du deuxième facteur du propriétaire (reste la commande d'exploitation, ADR 0046).

## Notes de session
