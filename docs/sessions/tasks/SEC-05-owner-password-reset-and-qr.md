# SEC-05 Mot de passe oublié (Telegram, puis e-mail) et QR code de la validation en deux étapes
Statut : in progress, lot 2 en PR (ADR 0068 acceptée par Charles le 05/11/2026, 18 h 13)
Phase : exploitation
Dépend de : ADR 0068, ADR 0046, ADR 0020 (bot de l'agence), EQ-10 (liens d'invitation et de réinitialisation)
Branche : claude/project-thread-a8l1w6 (fil Bilan)
Propriétaires : Bilan (auth, telegram, migration 0123, fixée à l’arrivée sur main) ; Extension écrit les écrans (QR, « Mot de passe oublié » de la page de connexion, page d'arrivée du lien par `LinkPage` et `NewPasswordPage`, Réglages › Telegram) ; QR en SVG en ligne, sombre sur fond blanc fixe avec une marge de 4 modules, même en Nuit ; sur téléphone, le bouton `otpauth` et la clé avant le QR

## Objectif (1 phrase)

Le propriétaire retrouve l'accès sans terminal, par un lien reçu en privé sur Telegram, et chacun active son deuxième facteur en scannant un QR code dessiné dans le CRM.

## Contexte à lire (fichiers précis)

- ADR 0068 (tout), ADR 0046 § 2, ADR 0020, ADR 0016.
- `apps/api/src/invitation-links.ts` (liens EQ-10 : empreinte seule, usage unique ; leur réinitialisation remet aussi le deuxième facteur à zéro, celle-ci jamais), `apps/api/src/auth.ts`, `apps/web/src/auth/SecondFactorPage.tsx`, module `telegram`.

## À faire (liste vérifiable)

Lot 1 : QR code
- [ ] QR de l'adresse `otpauth` dessiné dans le navigateur, à côté de la clé ; encodeur dans le dépôt ou bibliothèque ancienne en quarantaine de 14 jours ; aucun appel externe ; disparaît après confirmation.

Lot 2 : liaison Telegram privée (migration 0123)
- [x] API, connexion récente exigée : code à usage unique, 10 minutes, à envoyer au bot par `/start <code>` ; seule l'empreinte du code est gardée (`/v1/auth/telegram-link`, propriétaire et équipe). Écran de Réglages › Telegram : Extension.
- [x] Le bot garde l'identifiant du chat privé du compte, en rôle admin, pour ce seul usage ; délier possible ; audit.

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

- 06/11 (Bilan), lot 2 côté API. Routes `GET /v1/auth/telegram-link` (`{ linked, botUsername, linkedAt }`), `POST /v1/auth/telegram-link/code` (`{ code, botUsername, url, expiresAt }`, 10 par minute, 422 `telegram_link_no_bot_unprocessable` sans bot actif) et `DELETE /v1/auth/telegram-link`. Le code et le délier exigent une connexion récente. Tables `telegram_link_codes` et `telegram_private_links`, réservées au rôle admin. Le bot répond en privé : « C'est fait… » ou « Ce code ne marche plus… ». Il reste l'écran (Extension) et le lot 3.
- 06/11 (Extension), lot 2 côté écran. Onglet « Mon chat privé » de Réglages › Telegram (propriétaire), et le même bloc dans Moi › Sécurité pour l'équipe, puisque Réglages n'est pas à elle. Il reste le lot 3.
