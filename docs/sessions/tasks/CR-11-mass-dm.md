# CR-11 Mass DM automatiques : annonce après chaque publication, réveil, et jamais un fan submergé
Statut : todo (lot a) ; lots b, c et d après le lot a (ADR 0137, acceptée par Charles le 16/11/2026 et amendée deux fois le même jour ; ADR 0044 § 5)
Phase : espaces (ADR 0044, 0137)
Dépend de : CR-06, CR-08 lot b (publication confirmée), la capture Reveal du 16/11 (faite, formes dans l'ADR 0137 § 6 et § 8), la garde d'écriture (ADR 0018), l'ADR 0145 (réserve Mass DM)
Branche : task/cr-11<lot>-<slug> (une branche et une PR par lot)

## Objectif
Les Mass DM partent seuls vers une liste que le code calcule et vérifie : une annonce 30 minutes après chaque publication, un réveil quand plus personne ne parle, et trois types plus rares, sans jamais dépasser trois par semaine et par fan.

## Contexte à lire
`docs/adr/0137-mass-dm-after-a-post-and-wake-up.md` (tout, avec § 2 bis et § 3 bis), `docs/adr/0136-feed-and-stories-published-on-their-own.md`, ADR 0044 § 5, 0110 (§ 5 et § 6), 0126 (lives), 0088 § 7 (soin), 0132 (ventes gelées), 0135 (rythme lent), 0140 (`relanceNeedFor`), 0145, 0030 § 5 (« vu par ce fan »), 0018.

## Lot a : le connecteur (propriétaire : `packages/contracts` et module `connectors`, fil Bilan)
- [ ] Capacités facultatives du port : `createFanList`, `addFanToList`, `deleteFanList`, `estimateMassDmAudience`, `sendMassDm` (texte, médias facultatifs, heure, listes incluses et exclues, prix 0 toujours), `deleteMassDm`, `listMassDms`. Formes ajoutées à `docs/reference/reveal-api-observed.md` (forme seule) ; `FakeReveal` d'abord.
- [ ] Clé d'idempotence par Mass DM ; réponse perdue = relire les Mass DM avant toute tentative, jamais de renvoi à l'aveugle, ambre avec sa raison.
- [ ] Un ajout de fan qui échoue retire ce fan de l'envoi.

## Lot b : le plan, la liste et les gardes (fil « Publier posts et stories automatiquement » ; exclusions lues dans l'état de l'agent, fil Agent en relecture ; « OK » du fil Médias sur ce qui touche `content-drops`)
- [ ] Types : annonce (30 min après une publication confirmée, à tous les abonnés et anciens abonnés sauf ceux qui ont écrit dans les 30 dernières minutes) ; réveil (moins de 5 fans actifs en 3 h ou aucun Mass DM depuis 5 jours, au plus tous les 3 jours, jamais un jour d'annonce, avec un média Relance gratuit) ; réveil « en ligne » ; gros dépensier silencieux depuis 14 jours (texte personnel sans vente, 10 fans au départ) ; merci de fidélité (abonnés depuis 90 jours ou plus, une fois par trimestre, photo Relance gratuite).
- [ ] Aucun Mass DM payant. Plafond de 3 par semaine et par fan, tous types confondus, 36 h d'écart au moins ; priorité annonce, gros dépensier, réveil, fidélité ; lassitude : 3 sans réponse d'affilée = pause de 14 jours, levée quand le fan écrit.
- [ ] Exclusions : doute d'âge, mode soin et sortie de soin, ventes gelées, fan parti au milieu d'un sexto, « ne plus écrire », au milieu d'un script, rythme lent.
- [ ] Une liste statique par envoi (nom daté), créée et remplie 10 minutes avant, supprimée après ; les filtres de Reveal seulement en plus, jamais pour nos exclusions.
- [ ] Planifiés avec la semaine (CR-08), de préférence pendant un shift ; jamais pendant un live ni sur « Arrêt » ; décalé ou abandonné, jamais plus de 3 h en retard ; supprimé avant départ si son objet tombe.
- [ ] Texte : suggestif au plus, gardes de voix de l'agent (`ai_disclosure`), aucun prix ni lien, aucune phrase répétée dans les 30 jours.
- [ ] Un média Relance n'est jamais renvoyé : `unique (media_asset_id)` sur la table des médias d'un Mass DM, ligne d'envoi et job (`graphile_worker.add_job`, `job_key` = clé d'idempotence) dans la même transaction ; « vu par ce fan » appliqué. Seuls les médias du rôle Mass DM (ADR 0145) y entrent.
- [ ] `relanceNeedFor(créatrice, semaine)` exposé pour l'ADR 0140.
- [ ] Contexte de l'agent : Mass DM marqué « envoyé à tous », jamais cité comme personnel ; aucune relance de l'agent dans les 6 h.
- [ ] Modes « À valider » (obligatoire deux semaines ; propriétaire ou manager actif) et « Automatique » (propriétaire seul, journalisé).
- [ ] Mesure : destinataires, réponses à 24 h, achats à 48 h, désabonnements à 72 h ; ambre au-dessus de 2 %.

## Lot c : l'équipe prévenue (fil Design pour `apps/web`, fil Équipe pour le Planning, fil Extension pour le copilote)
- [ ] Carte « Prochain Mass DM » sur Aujourd'hui du chatteur (heure dans son fuseau, sorte, sujet, sans le média) ; repère sur son Planning.
- [ ] Signal du copilote quand un fan répond à un Mass DM.
- [ ] Vue Dashboard des Mass DM de la semaine (heure, sorte, destinataires) pour le propriétaire et les managers. Captures de recette avant fusion.

## Lot d : le premier essai réel
- [ ] Un Mass DM vers une liste qui ne contient que le compte fan « test », seulement sur le mot écrit de Charles dans le fil qui l'exécute, qui nomme l'action et le compte.

## Critères d'acceptation
- Tests contre `FakeReveal` : un média Relance jamais dans deux envois, double validation sans double envoi, garde fermée = rien ne part, liste créée puis supprimée, ajout en échec retiré de l'envoi.
- Tests du domaine : plafond 3 par semaine et 36 h d'écart, priorité respectée, pause de lassitude, chaque exclusion écarte le fan, rien pendant un live.

## Hors périmètre
Mass DM payant (refusé par Charles le 16/11) ; réutilisation des médias anciens.

## Notes de session
- 03/11/2026 : l'ADR 0055 (proposée) nomme la catégorie « Relance » (`mass_dm`) : une petite photo, une petite vidéo ou un petit vocal pour relancer les fans (Charles, 9 h 53).
- 17/11/2026 : fiche réécrite après l'ADR 0137 (fusionnée avec #824) : capture faite, prix (aucun), listes et cadence décidés ; découpée en quatre lots.
