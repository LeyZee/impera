# TG-01 Telegram pour les canaux seulement : les alertes passent par les notifications d'Impera
Statut : in_progress
Phase : exploitation (ADR 0176)
Dépend de : ADR 0176 (proposée le 27/11/2026, décision de Charles du même jour) ; module `notifications` (ADR 0042 § 7) ; routeur des alertes (ADR 0150)
Branche : claude/project-thread-vvwzig
Propriétaire proposé : Bilan (serveur, base, fusion) ; Sécurité (mot de passe oublié, portée des alertes) ; Design (écrans)

## Objectif (1 phrase)

Telegram ne sert plus qu'au canal de chaque créatrice ; tout ce qu'il disait à l'agence sonne en notification Impera, avec relance pour la sécurité.

## Contexte à lire (fichiers précis)

- ADR 0176, et les amendements datés du 27/11 de 0046, 0059, 0068, 0080, 0088, 0150.
- `apps/api/src/modules/telegram/README.md`, `apps/api/src/modules/alerts/README.md`, `apps/api/src/modules/notifications/README.md`.
- `docs/runbooks/alerts.md`, `docs/runbooks/telegram.md`.

## À faire (liste vérifiable)

- [x] Module `telegram` réduit aux bots et aux canaux : routage, scan, envois groupés, récap du matin, bilan du soir, rappels de panne, ventes et chat privé retirés.
- [x] Alertes de l'agence par `notifications` : job `alerts.agency` (motifs `agency_urgent` et `agency_alert`), relance de sécurité `alerts.remind_safety` toutes les 5 minutes pendant une heure.
- [x] Migration : motifs ajoutés à la contrainte de `notifications`, déclencheur `domain_events_telegram_scan` retiré. Aucune table supprimée.
- [x] Mot de passe oublié sans Telegram : la page dit d'où vient le lien ; `pnpm ops:password-reset-link --email <e-mail>` pour un propriétaire.
- [x] Écrans : Réglages › Bots Telegram en trois étapes, Réglages › Alertes et l'onglet Alertes sans Telegram, bandeau de nuit du Dashboard retiré, étape « Alertes de nuit » de la Mise en route, Moi › Sécurité sans chat privé.
- [x] Guides de l'app (`apps/web/src/help/guides.ts`) : les quatre passages Telegram réécrits.
- [x] ADR 0176, amendements, index, glossaire, README des modules, runbooks.
- [x] ADR 0176 confirmée par Bilan ; migration 0286 (numéro définitif donné par Bilan au tour de fusion).
- [ ] Relectures : Sécurité (mot de passe oublié, portée des alertes), Design (écrans).

## Critères d'acceptation

- `pnpm check` vert ; tests unitaires web, api, contracts verts ; intégration `telegram`, `telegram-wiring`, `password-reset`, `alerts` verte.
- Aucun envoi vers Telegram hors d'un canal de créatrice ; aucune route `/v1/settings/telegram/routes`, `/deliveries`, `/sales` ni `/v1/auth/password-reset` (demande).
- Un relais de sécurité non pris sonne de nouveau à 5, 10, … 60 minutes, puis plus.

## Hors périmètre

- Supprimer les tables Telegram qui ne servent plus : migration à part, sur le mot écrit de Charles.
- L'aperçu des posts en notification (lot du canal, PR « Publier sur Telegram à sa place »).
- Les écarts de persona en notification (ADR 0059 amendée) : pas encore codés.
- Les récaps pour l'agent IA de Charles (lot « connexion par compte », après le VPS).
- L'envoi du lien de mot de passe par e-mail (avec le domaine).

## Notes de session

- L'escalade vers l'autre propriétaire au bout de 15 minutes disparaît : tous les propriétaires sont prévenus dès la première minute.
- Les rappels de panne toutes les deux heures disparaissent : la panne sonne une fois, le Dashboard la montre.
- La case `notify` d'une alerte personnalisée devient « Prévenir l'équipe » ; le routeur des alertes de la créatrice ne la lit pas encore (découverte).

## Résultat

En attente des relectures et de la fusion.
