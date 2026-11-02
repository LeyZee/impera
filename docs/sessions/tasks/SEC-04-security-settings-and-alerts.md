# SEC-04 Réglages › Sécurité et alertes de sécurité
Statut : done (alertes #400, écran #404)
Phase : exploitation
Dépend de : ADR 0046, ADR 0020, SEC-02
Branche : claude/project-thread-8fl2b1 (fil « Auditer et sécuriser Nirvana »)

## Objectif (1 phrase)

Chacun voit et ferme ses sessions, et le groupe Telegram urgent apprend ce qui touche à la sécurité, sans nom ni contenu (ADR 0046 § 7 et 8).

## Contexte à lire (fichiers précis)

- ADR 0046, ADR 0020, `apps/api/src/modules/telegram/`.

## À faire (liste vérifiable)

- [x] Réglages › Sécurité : sessions ouvertes (appareil, réseau, dernière activité ; pas de pays, choix de Charles du 02/11), fermer une ou toutes sauf celle-ci (« toutes » oublie aussi les appareils de confiance) ; pour le propriétaire, deuxième facteur actif ou non par membre et « fermer toutes ses sessions ».
- [x] Signaux Telegram (groupe urgent) depuis `audit_log` : connexion du propriétaire depuis un appareil nouveau, 5 refus en 15 minutes sur un compte, deuxième facteur remis à zéro, persona activée, mode Automatique allumé, session Reveal remplacée.
- [x] Aucun nom de fan, aucun contenu, aucune adresse IP complète dans un message.
- [x] Regénérer les dix codes de secours depuis Réglages › Sécurité, avec le mot de passe et un code (reporté de SEC-02).
- [x] Confirmations : libellé visible au-dessus du champ de code (« Code à 6 chiffres ou de secours »), dans les quatre confirmations (relecture Extension de SEC-02).
- [x] Activation : déplacer le focus sur le titre ou le champ de l'étape suivante (relecture Extension de SEC-02).

## Critères d'acceptation (tests, commandes, comportements observables)

- Intégration : chaque événement écrit sa ligne d'audit et un seul signal ; fermer une session la rend inutilisable à la requête suivante.
- Captures téléphone et ordinateur, Nuit et Jour, relues par Extension.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Jeton d'extension par appareil (ADR à écrire avec le fil Reveal).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Livrée en deux PR : (1) les alertes, côté serveur, migration 0064 ; (2) l'écran Réglages › Sécurité, les codes de secours et les deux reprises de SEC-02. Le lien des alertes mène à Réglages jusqu'à l'écran, puis à Réglages › Sécurité.
- « Appareil nouveau » = un appareil que rien n'a épargné : la connexion du propriétaire a demandé un code, ou aucun n'était encore activé. Un appareil de confiance (30 jours) ne dit rien ; l'activation, qui suit une connexion déjà dite, non plus. Pas d'empreinte d'appareil : ni dépendance ni donnée de plus.
- « 5 refus en 15 minutes » compte les mots de passe faux à la connexion, les codes faux (connexion, activation) et les confirmations refusées, sur le même compte, chacun d'abord écrit dans `audit_log` ; dit une fois par quart d'heure et par compte au plus. Un e-mail inconnu n'écrit rien.
- « Session Reveal remplacée » = une session valide remplacée par une autre ; renouveler une session expirée, ou renvoyer la même, est ordinaire.
- Automatique allumé : depuis le mode de l'agent (toutes ses conversations) ou sur une conversation ; une ligne `automatic.on` dans `audit_log`, qui n'existait pas.
- Lot 2 : sessions sans pays, par choix de Charles (02/11, 20h29) : appareil, réseau (`networkOf`) et dernière activité seulement ; aucune base géographique ni dépendance. Le propriétaire trouve l'écran dans Réglages › Sécurité, un manager ou un chatteur dans Moi › Sécurité (Réglages est au propriétaire seul, NAV-18). La vue des comptes ne montre au propriétaire ni appareil ni réseau d'un autre compte : le deuxième facteur, le nombre de sessions et la dernière activité. Le lien des alertes Telegram mène maintenant à Réglages › Sécurité.
- Une opératrice ou une créatrice n'a ni Réglages ni Moi : son écran est `/compte/securite`, hors du rail. L'entrée « Sécurité » du menu du compte (et de « Plus » sur téléphone) mène, pour chaque rôle, à son écran (relecture Extension de #404).
