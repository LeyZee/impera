# PUB-01 Connecteur de publication Telegram : le canal d'actualité de la créatrice
Statut : in_progress (ADR 0057, ADR 0080 acceptée par Charles le 07/11/2026 12h26 et 13h05 ; lot A1 fait, A2 attend ses exemples)
Phase : publication (ADR 0057, ADR 0080)
Dépend de : CR-06, P3-07 (bot Telegram) ; vidéo publique Reveal (lot B) : CR-08 et les captures de Charles
Branche : claude/project-thread-km6hfy

## Objectif
Des posts partent seuls sur le canal Telegram de la créatrice, à des créneaux réglés (19 h pour commencer), montrés une heure avant à l'agence, avec un média du pool, une légende dans sa voix et le lien de redirection réglé dans le CRM, pour ramener du monde sur Reveal.

## Contexte à lire
ADR 0080, ADR 0057, ADR 0055, ADR 0020, `docs/architecture/connectors.md`, README du module `telegram`.

## À faire
### Lot A1 : branchement et réglages
- [x] Contrats : canal, créneaux, liens de redirection, réglages du canal (Zod).
- [x] Migration 0137 : `telegram_channels` (canal, créneaux, liens, réglage entier par créatrice), RLS forcée sans politique ; la table des posts vient au lot A3.
- [x] Le bot administrateur et son droit de publier sont lus de `telegram_chats` (découverte existante) ; le port de publication et `FakeTelegramChannel` passent au lot A3, avec l'envoi.
- [x] Routes des réglages (propriétaire) et écran Réglages › Créatrices › Canal Telegram : canal, créneaux, liens.
### Lot A1 bis : où mène un lien (« ok lien-ponctuel », 07/11 14h56)
- [x] ADR 0080 amendée (§ 4.5, § 4.6, phrases ‡).
- [x] Champ « Où il mène » de chaque lien : contrat (`destination`, 120 caractères, sans adresse), écran, tests.
### Lot A2 : le post
- [ ] Exemples de Charles saisis dans le CRM (jamais dans le dépôt).
- [ ] Le prompt lit « où il mène » du lien porté (bloc délimité) : le post parle de cet endroit, jamais d'un autre.
- [ ] Prompt `telegram_channel` versionné, schéma de sortie structuré, rendu HTML Telegram échappé, gardes, conseil de réécriture en bloc délimité.
- [ ] Mode Post du canal du playground.
### Lot A3 : l'automatique
- [ ] Job des créneaux : préparation à H-fenêtre, annonce au groupe Info, envoi à l'heure, clé d'idempotence, réponse perdue = ambre.
- [ ] Valider, Réécrire (avec conseil), Changer de média, Changer de lien (ce post seulement, légende réécrite pour son endroit), Corriger, Ne pas publier.
- [ ] Demande de dépôt automatique quand le pool baisse ; pool vide = ambre.
- [ ] Journal et vues à 48 h (des nombres seulement).
### Lot B
- [ ] Vidéo publique Reveal reprise sur le canal (après les captures et CR-08).

## Critères d'acceptation
- Tests contre le faux : double déclenchement d'un créneau sans double post, bot non administrateur = ambre lisible, pool vide = rien ne part et une demande existe, conseil qui demande une adresse = refusé par la garde.

## Hors périmètre
Instagram (PUB-02), agents externes (MCP-PUB).

## Notes de session
- 07/11 : ADR 0080 écrite d'après les réponses de Charles (19 h, fenêtre 1 h, conseil de réécriture, pool qui se remplit seul, vidéo publique Reveal, lien de redirection hors Reveal, playground à deux modes). Bot pas encore créé ; canal de Messa existant.
