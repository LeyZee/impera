# SEC-04 Réglages › Sécurité et alertes de sécurité
Statut : todo
Phase : exploitation
Dépend de : ADR 0046, ADR 0020, SEC-02
Branche : claude/project-thread-8fl2b1 (fil « Auditer et sécuriser Nirvana »)

## Objectif (1 phrase)

Chacun voit et ferme ses sessions, et le groupe Telegram urgent apprend ce qui touche à la sécurité, sans nom ni contenu (ADR 0046 § 7 et 8).

## Contexte à lire (fichiers précis)

- ADR 0046, ADR 0020, `apps/api/src/modules/telegram/`.

## À faire (liste vérifiable)

- [ ] Réglages › Sécurité : sessions ouvertes (appareil, pays approximatif, dernière activité), fermer une ou toutes sauf celle-ci (« toutes » oublie aussi les appareils de confiance) ; pour le propriétaire, deuxième facteur actif ou non par membre et « fermer toutes ses sessions ».
- [ ] Signaux Telegram (groupe urgent) depuis `audit_log` : connexion du propriétaire depuis un appareil nouveau, 5 refus en 15 minutes sur un compte, deuxième facteur remis à zéro, persona activée, mode Automatique allumé, session Reveal remplacée.
- [ ] Aucun nom de fan, aucun contenu, aucune adresse IP complète dans un message.
- [ ] Regénérer les dix codes de secours depuis Réglages › Sécurité, avec le mot de passe et un code (reporté de SEC-02).
- [ ] Confirmations : libellé visible au-dessus du champ de code (« Code à 6 chiffres ou de secours »), dans les quatre confirmations (relecture Extension de SEC-02).
- [ ] Activation : déplacer le focus sur le titre ou le champ de l'étape suivante (relecture Extension de SEC-02).

## Critères d'acceptation (tests, commandes, comportements observables)

- Intégration : chaque événement écrit sa ligne d'audit et un seul signal ; fermer une session la rend inutilisable à la requête suivante.
- Captures téléphone et ordinateur, Nuit et Jour, relues par Extension.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Jeton d'extension par appareil (ADR à écrire avec le fil Reveal).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)
