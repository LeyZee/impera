# Relances : après la bienvenue, à la connexion, sur un événement, sans jamais se répéter
Statut : proposed (ID à donner par Charles ; née de l'étude de Desirely du 27/10)
Phase : 3
Dépend de : P3-10 (relances en brouillon, livrée), fiche « Heures d'activité de l'agent », capture Reveal (présence en ligne, message de bienvenue)
Branche : task/<id>-follow-ups-extended

## Objectif
Étendre les relances de P3-10 aux trois moments que Desirely couvre et que nous n'avons pas, avec un aperçu de l'heure prévue et une approche qui change à chaque fois.

## Contexte à lire
`apps/api/src/modules/agent/domain/follow-up.ts`, `PersonaFollowUpsSchema` (`packages/contracts/src/persona.ts`), P3-10, méthode de chatting §6 (hors dépôt), `docs/reference/desirely-analysis.md` (§ Relances).

## Ce que fait Desirely
Trois types : après le message de bienvenue resté sans réponse, après un silence, à la connexion du fan (Reveal seulement). Jusqu'à trois relances par type, délai réglable, aperçu de l'heure d'envoi, approche jamais reprise, choix d'un « bon moment », registre (tu / vous) respecté. Le playbook ajoute : la relance sur événement (anniversaire, « à demain » dit par le fan), et la relance courte d'un PPV non ouvert (traitée dans la fiche « Déroulé d'un script »).

## À faire
- [ ] Type de relance dans `PersonaFollowUpsSchema` lui-même, pas à côté : `after_welcome`, `silence` (les `delays_hours` existants), `on_online` (si la capture montre la présence), `event` ; trois au plus par type et par fan, bornes dans `PERSONA_BOUNDS`.
- [ ] Approche notée sur chaque relance (question, souvenir, taquinerie, nouvelle de sa journée, appel à un détail de la note du fan) ; le composeur reçoit les approches déjà prises pour ce fan et ne les reprend pas.
- [ ] « Bon moment » : l'heure où ce fan écrit d'habitude, calculée sur ses messages, dans les heures d'activité de la créatrice.
- [ ] Événement : anniversaire lu dans la note du fan (catégorie `identity`), « à demain » ou « je te réécris ce soir » relevé par le cerveau comme fait daté.
- [ ] Aperçu dans le lecteur de conversation du Suivi, en encre pâle : « Relance prévue à 18 h 40 », avec l'heure au format du planning (`clockAt`, espaces insécables). « Annuler » est un bouton discret, sans confirmation : l'annulation se défait par un « Annulée · Rétablir » de quelques secondes.
- [ ] Toujours : jamais `doNotContact`, jamais après un risque, rien de payant ni de sexuel, brouillon tant que l'Automatique n'est pas ouvert.

## Critères d'acceptation
- Tests : trois relances au plus par type ; une approche prise n'est pas reprise ; un fan qui répond annule les relances prévues ; anniversaire sans date connue ignoré.
- Évals : trois relances d'affilée au même fan, toutes différentes.
- Écran : Nuit et Jour, 1 440 et 400 px, mouvement réduit, état « Le serveur ne répond pas ».

## Hors périmètre
Les messages de masse et la segmentation (décision à prendre plus tard, voir journal).

## Notes de session
