# 0110. L'agent tient compte des automatisations de Reveal

Statut : accepted (« ok 0110 » de Charles le 14/11/2026, 13 h 08 heure de Paris ; demande de Charles du 14/11/2026 : « applique tout ça », après la lecture du guide Reveal pour les agences ; numéro attribué par le coordinateur le 14/11)
Date : 2026-11-14
Remplace : la ligne « Automatisations de Reveal : actives, mais sans effet sur le bot » de `docs/reference/reveal-connector-inventory.md` (décision du 17/10). Précise : P3-10 (relances), ADR 0006 (debounce), ADR 0018 (ce que Reveal donne du fan).

## Contexte

Le guide de Reveal pour les agences (lu le 14/11) montre que plusieurs automatisations écrivent dans la conversation, et que la réponse de l'agent change leur comportement :

- **Accroche** : juste après l'abonnement, Reveal propose au fan trois messages prêts à envoyer. S'il en choisit un, il part **sous le nom du fan**. Un réglage fait partir une réponse automatique **sous le nom de la créatrice** après un délai de 5 s à 10 min, sauf si quelqu'un a déjà répondu. Quand le fan a envoyé une accroche, la bienvenue ne part pas.
- **Bienvenue** : jusqu'à trois messages, chacun avec son délai et un média possible. La suite s'arrête dès que le fan ou la créatrice répond.
- **Réponse à une story** : arrive dans la conversation, avec la story, comme un message gratuit.
- **Mass DM** : un Mass DM resté sans réponse, réaction ni achat disparaît chez le fan au bout de 7 jours (réglage d'agence). Un envoi « à la connexion du fan » existe aussi.
- **Rappel d'expiration** : un message part avant la fin de l'abonnement.

Ce que fait le code aujourd'hui (main au 14/11) :

- tout message côté créatrice qui ne vient pas du membre « bot » est `human` : le cerveau le lit comme écrit par la créatrice ;
- l'agent répond après le debounce (ADR 0006) au dernier message du fan, même si un message côté créatrice est arrivé entre-temps : la conversation reste `pending` ;
- l'agent ne parle jamais en premier ; ses relances (P3-10) partent après un silence du fan, ancrées sur son dernier message ;
- la relance « à la connexion du fan » n'existe que dans la fiche proposée `PROPOSED-follow-ups-extended.md` ;
- le connecteur lit déjà `storyReply` (forme inconnue) et la bienvenue du modèle (`welcomeMessage`, son délai), sans s'en servir ; aucun champ observé ne dit qu'un message est un Mass DM, sauf `massDMId` dans l'historique PPV.

## Décision

Règles acceptées par Charles le 14/11. La règle 1 est déjà appliquée côté compte : Charles a coupé la réponse automatique à l'accroche le 14/11.

1. **Accroche.** La réponse automatique de Reveal à l'accroche est coupée dans le compte (réglage fait par l'agence, hors code). Le connecteur reconnaît une accroche : message du fan dont le texte, une fois `%NAME%` retiré, est identique à l'un des modèles d'accroche du compte. Le cerveau la lit comme « il a choisi une accroche toute faite », jamais comme ses propres mots : aucune note du fan n'en est tirée, l'agent ne la cite pas comme s'il l'avait écrite.
2. **Rien par-dessus une réponse déjà faite.** Quand un message côté créatrice (automatisme de Reveal, chatteur, créatrice) arrive après le dernier message du fan, le brouillon ouvert de l'agent tombe et aucune réponse ne part pour ce message du fan. La garde vaut même si une automatisation reste active.
3. **Bienvenue.** L'agent ne parle jamais en premier à un nouvel abonné : la bienvenue de Reveal fait ce travail, et l'agent ne coupe jamais sa séquence (seul le fan la coupe en répondant). Les messages de bienvenue sont marqués comme tels dans le contexte du cerveau, pour qu'il ne les répète pas.
4. **Réponse à une story.** Un message du fan qui répond à une story est marqué comme tel dans le contexte du cerveau (« il réagit à ta story »). Le cerveau ne voit pas l'image de la story tant que sa forme n'est pas capturée. Un message vide (réaction seule) reçoit une réponse courte, comme un autre.
5. **Mass DM.** Un Mass DM est marqué « envoyé à tous » dans le contexte du cerveau, qui ne le cite jamais comme un message personnel. Un Mass DM de plus de 7 jours sans réponse, réaction ni achat du fan est retiré de ce contexte (le fan ne le voit plus).
6. **Relances.** Une relance de l'agent ne part pas dans les 6 h qui suivent un message automatique de Reveal (rappel d'expiration, Mass DM) ; elle est remise à la fin de ce délai. L'agence envoie ses Mass DM de relance aux seuls fans qui n'ont pas écrit depuis une durée qu'elle choisit (précision de Charles le 14/11) : ils visent les mêmes fans silencieux que les relances de l'agent, d'où ce délai. La relance « à la connexion du fan » de la fiche proposée ne se code pas tant que le Mass DM « à la connexion » est actif dans le compte.
7. La ligne de l'inventaire du connecteur est corrigée : les automatisations ont un effet sur le bot, et cette ADR dit lequel.

## Ce qui reste à capturer avant le code

À la prochaine capture sur le PC de Charles, avec le seul compte fan test et sans envoyer de Mass DM :

- la page Automatisations (accroches, réponse automatique et son délai, bienvenue en trois messages, rappel d'expiration, Mass DM à la connexion) et les appels qu'elle fait ;
- un abonnement du fan test, une accroche choisie, la bienvenue reçue ;
- une réponse du fan test à une story (forme de `storyReply`) ;
- un Mass DM déjà présent dans la conversation du fan test, s'il en existe un.

Ce qui distingue un message d'automatisme d'un message de chatteur (nom affiché, `type`, autre champ) se lit dans cette capture. Sans signe sûr, les règles 3 et 5 ne s'appliquent pas, et la règle 2 s'applique à tout message côté créatrice.

## Conséquences

- Plus de double réponse quand Reveal ou un chatteur a déjà répondu, avant l'ouverture d'Automatique.
- Le cerveau cesse de prendre les automatismes pour des phrases du fan ou de la créatrice.
- Le contrat `ExternalMessage` gagne une origine du message (accroche, bienvenue, story, Mass DM) : un terme nouveau entre au glossaire dans la PR du code.
- Propriétaires : Agent (agent, conversations), Bilan (connecteur, contrats).
