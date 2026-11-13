# 0090. Une demande sur mesure passe à un chatteur qui prend la commande ; une objection de prix reçoit une réplique de la banque de l'agence

Statut : accepted (Charles, 11/11/2026 17h59, « ok 0090 », fil Agent ; décisions du 11/11 à 17h51, fil « Évaluer la capacité de vente de l'IA »)
Date : 2026-11-11
Précise : P4-01 (alerte système `service_request`), l'ADR 0023 (passation à l'humain), l'ADR 0021 (elle reste elle-même), l'ADR 0010 (rien de réel dans le dépôt), la garde « jamais de négociation ».
Amende : l'ADR 0079 § 4 et § 6 (deux questions de plus dans la section « Conversation », une partie de plus dans « Réglages de l'agent »).

## Contexte

**Demande sur mesure.** Quand un fan demande quelque chose qui n'est pas dans ce qu'elle vend (une vidéo à son prénom, une tenue précise, un appel), le cerveau le classe `asks_for_service`. Jusqu'ici, si l'alerte « Demande de service » était allumée, l'équipe était prévenue, mais l'agent continuait seul sans consigne : il pouvait dire oui, inventer un délai, ou refuser une vente que l'équipe aurait faite. Charles veut que l'IA ne vende jamais de sur-mesure : l'équipe est alertée et un chatteur prend la commande.

**Objection de prix.** Le cerveau classe `price_objection` (« c'est trop cher », « fais-moi un prix »). La garde interdit déjà toute baisse de prix, mais la voix improvisait sa réponse. Charles veut des répliques prêtes, par type d'objection, que l'agent adapte à sa voix. Ces répliques sont une méthode de l'agence : elles ne vont jamais dans le dépôt, qui est public.

## Décision

### A. Demande sur mesure

1. **Ce qui l'ouvre.** L'intention `asks_for_service` lue par le cerveau : une demande qui n'est ni un média de son catalogue ni un script. Ce qui s'y trouve reste `asks_for_media` (vente normale). Une fausse alerte coûte une passation, jamais une vente perdue.

2. **Le code décide, pas le prompt** (`agent/domain/custom-order.ts`, `customOrderDecision`) :
   - **un chatteur est en poste** sur ses comptes : passation de cause `custom_order` (nouvelle cause fermée de `HANDOFF_CAUSES`), la voix n'écrit rien. Le chatteur prend la commande dans Reveal : le prix et le délai sont les siens, jamais ceux de l'agent ;
   - **personne en poste** : l'agent répond avec une consigne fixée dans le code, comme celle des pièges. Il accueille la demande et dit qu'il va voir, sans oui ni non, sans prix, sans délai, sans rien promettre, puis reprend la conversation ;
   - **une commande attend déjà** pour ce fan : il n'en ouvre pas une autre et dit seulement qu'il ne l'a pas oubliée, toujours sans engagement ;
   - **rien ne peut lui être vendu** (« Ventes gelées », « Ne plus lui écrire », un risque de `NO_SALE_RISKS`) : aucune commande ne s'ouvre ; l'agent n'entre pas dans la demande, sans reproche ;
   - **ses limites sont inconnues** (playground, compositeur sans elles) : la réponse d'attente, mais aucune commande ouverte et aucun chatteur appelé.

3. **La garde `no_commitment`.** Sur une réponse à une demande sur mesure, elle bloque un oui (« je te fais ça », « c'est d'accord »), un délai (« demain », « ce soir », « dans 2 jours », « d'ici vendredi ») et un prix (une somme, « ça te coûtera »), bulle par bulle et sur le message entier. Bloquée, la réponse part à un humain comme pour toute garde bloquante.

4. **Le journal.** Une commande ouverte écrit `custom_order_opened` sur la conversation, que la réponse parte ou soit retenue. Elle reste ouverte jusqu'au prochain `takeover_started`. Tant qu'elle est ouverte et que la conversation n'est pas déjà chez un humain, elle a sa ligne dans « À traiter » (cause « Demande sur mesure », rang « important », jamais « grave »). Une commande prise par un chatteur en poste est déjà une passation : elle y figure comme telle.

5. **Le routage.** La passation suit le routage existant des passations. Le routage personnel au membre en poste dépend d'EQ-08 : sans lui, la ligne est visible de toute l'agence.

6. **Ce qui ne change pas.** Les gardes dures (rencontre, paiement hors plateforme, coordonnées, `ai_disclosure`) passent avant. Un piège passe avant la demande sur mesure. L'alerte « Demande de service » prévient toujours l'équipe quand elle est allumée.

### B. Objections de prix

7. **Le type est lu par le cerveau, la réplique choisie par le code.** Le brief gagne `objection`, une liste fermée renseignée seulement avec `price_objection` : `too_expensive`, `real_is_cheaper`, `free_elsewhere`, `asks_discount`, `already_paid`, et `other`, qui n'a pas de réplique.

8. **Jamais deux fois la même au même fan** (`agent/domain/objections.ts`, `pickObjectionReply`). Le code prend, dans l'ordre où l'agence les a écrites, la première réplique de ce type que ce fan n'a jamais reçue. Quand toutes y sont passées, ou pour `other`, la voix répond seule, sous les gardes. La réplique arrive à la voix dans un bloc typé `<objection_reply>`, qu'elle dit avec ses mots, sans la recopier, sans rien baisser ni promettre.

9. **Le journal.** Un brouillon écrit avec une réplique journalise `objection_reply_used` (type d'objection et identifiant, jamais le texte), et le choix du point 8 lit ces événements. Une réplique compte comme reçue dès son brouillon, même refusé : mieux vaut en perdre une que la répéter.

10. **La banque vit avec sa persona, jamais dans le dépôt.**
    - Elle est rangée dans les réglages de l'agent de sa version de persona (`agent.objection_replies`), en base : pas de table à part, versionnée avec la fiche.
    - Elle s'édite dans « Réglages de l'agent », par le propriétaire seul, qui seul enregistre une version. Chaque réplique reçoit à sa création un identifiant tiré au hasard, jamais réutilisé.
    - Le propriétaire seul la lit. Un chatteur ou un manager lit les versions avec une banque vide, et la créatrice ne lit jamais les réglages de l'agent. Elle n'entre jamais dans un prompt entière : seule la réplique choisie y entre.
    - Le dépôt ne contient que le mécanisme, et des répliques neutres de test (« Réplique de test A »).

11. **Les gardes restent maîtres.** À l'enregistrement, chaque réplique passe les gardes dures avec ses mots interdits, comme les réponses typiques (422 `persona_sample_reply_unprocessable`, la réplique nommée par son type et sa place, jamais par son texte). À l'envoi, la réponse adaptée passe toutes les gardes, dont « jamais de négociation ».

### C. Le guide de voix

12. **Deux questions de plus dans la section « Conversation »** (amende l'ADR 0079 § 6 : 61 questions), en texte libre, lues par la voix :
    - **« Comment elle dit non »** (`limit_setting_description`) : comment elle refuse, recadre ou pose une limite, sans casser l'ambiance ;
    - **« Ce qu'elle n'écrirait jamais »** (`sounds_wrong_description`) : les tournures, les mots et les attitudes qui ne lui ressemblent pas.

    Les interdits stricts restent dans « Réglages de l'agent » et dans les gardes : ces deux champs guident le ton, ils ne bloquent rien. Le prompt de voix dit seulement de les suivre.

## Conséquences

- L'IA ne vend plus de sur-mesure. C'est le code qui la retient : la décision `customOrderDecision` et la garde `no_commitment`.
- Une commande n'est jamais perdue faute de chatteur : elle attend dans « À traiter ».
- Les répliques de l'agence restent secrètes : le dépôt public ne montre que le mécanisme.
- Migration 0182 : les deux types d'événements entrent dans les contraintes de `conversation_events` et `domain_events`. Aucune table.
- Prompts versionnés : cerveau 1.12.0 (`objection`), voix 1.7.0 (les deux champs, le bloc `<objection_reply>`).
- Évals : demande sur mesure avec et sans chatteur, commande déjà ouverte, chaque type d'objection, réplique déjà reçue.
