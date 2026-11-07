# PUB-01 Connecteur de publication Telegram : le canal d'actualité de la créatrice
Statut : in_progress (ADR 0057, ADR 0080 acceptée par Charles le 07/11/2026 12h26 ; lot A1)
Phase : publication (ADR 0057, ADR 0080)
Dépend de : CR-06, P3-07 (bot Telegram) ; vidéo publique Reveal (lot B) : CR-08 et les captures de Charles
Branche : claude/project-thread-km6hfy

## Objectif
Des posts partent seuls sur le canal Telegram de la créatrice, à des créneaux réglés (19 h pour commencer), montrés une heure avant à l'agence, avec un média du pool, une légende dans sa voix et le lien de redirection réglé dans le CRM, pour ramener du monde sur Reveal.

## Contexte à lire
ADR 0080, ADR 0057, ADR 0055, ADR 0020, `docs/architecture/connectors.md`, README du module `telegram`.

## À faire
### Lot A1 : branchement et réglages
- [ ] Contrats : canal, créneaux, liens de redirection, réglages du canal (Zod).
- [ ] Migration 0137 : tables du canal, des créneaux, des liens, des posts ; RLS selon la règle des tables nouvelles.
- [ ] Port du connecteur de publication et `FakeTelegramChannel` : publier une vidéo, une photo ; vérifier que le bot est administrateur et peut publier.
- [ ] Routes des réglages (propriétaire) et écran Réglages › Créatrices › Canal Telegram : canal, créneaux, liens.
### Lot A2 : le post
- [ ] Exemples de Charles saisis dans le CRM (jamais dans le dépôt).
- [ ] Prompt `telegram_channel` versionné, schéma de sortie structuré, rendu HTML Telegram échappé, gardes, conseil de réécriture en bloc délimité.
- [ ] Mode Post du canal du playground.
### Lot A3 : l'automatique
- [ ] Job des créneaux : préparation à H-fenêtre, annonce au groupe Info, envoi à l'heure, clé d'idempotence, réponse perdue = ambre.
- [ ] Valider, Réécrire (avec conseil), Changer de média, Corriger, Ne pas publier.
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
