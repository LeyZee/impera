# EQ-08 Mode hybride : passage à l'humain pour vendre, routage et attribution
Statut : blocked (lot 4 de l'ADR 0023, ID validé par Charles le 27/10/2026 ; attend la capture Reveal et les clés)
Phase : 3-4 (moteur et Suivi), après la capture Reveal et les clés
Dépend de : EQ-02, P6-01 (`sales`), le composeur de l'agent, la capture Reveal
Branche : task/eq-08-hybrid-sale-handoff

## Objectif
Quand la méthode dit qu'il est temps de vendre, l'agent passe la main au chatteur en poste au lieu de dérouler un script, puis reprend la relation quand le chatteur rend la main ; chaque vente détectée revient à celui qui tenait la conversation.

## Contexte à lire
`docs/adr/0023-team-management.md` (§ Mode hybride, en entier), `docs/architecture/message-flow.md`, `docs/architecture/ai-engine.md` (la politique), `apps/api/src/modules/conversations/domain/state-machine.ts`, `packages/contracts/src/dashboard.ts` (`HandoffCauseSchema`, `HANDOFF_CAUSES`), `apps/api/src/modules/supervision/domain/dashboard.ts` (`WHY`), `apps/api/src/modules/agent/domain/hold.ts` (`protectionFor`), `docs/sessions/tasks/P6-01-sales-catalog.md`, ADR 0019, ADR 0020. Méthode de chatting : `/mnt/project-files/chatting/methode-chatting.md` (hors dépôt).

## À faire
- [x] **Prérequis, avant qu'un chatteur reçoive des `creator_ids`** (fait par Bilan, migration 0016 : `routed_to_user_id`, `routedCreatorIds`) : le filtre du serveur « un chatteur ne lit que les conversations qui lui sont routées » existe dans `conversations` (fait par le propriétaire de `conversations`). EQ-13 ouvre ensuite au chatteur les créatrices de son shift, pendant le shift seulement (ADR 0025). Aujourd'hui, un `operator` lit toutes les conversations de ses `creator_ids`.
- [ ] Contrats (via le propriétaire de `packages/contracts`) : cause `sale` dans `HandoffCauseSchema`, avec son texte dans `WHY` ; réglage par créatrice « Qui vend » (`sellerMode` : `agent` | `team` | `both`), `team` par défaut au lancement (Charles, 27/10, 15h11 : « les deux peuvent vendre. Mais au début, ça va être les chatteurs seulement, le temps qu'on entraîne l'IA ») ; le propriétaire passe une créatrice à `both` dans ses réglages quand l'agent est prêt, jamais le code tout seul, et l'agent n'envoie seul qu'en Automatique (ADR 0019) ; issue de la passation `releaseOutcome` (`sold` | `refused` | `none`) sur « Rendre la main » ; auteur d'une vente (`agent` ou un utilisateur). La migration qui élargit les contrôles de type d'événements passe par le propriétaire de `packages/db`.
- [ ] Politique : là où `offerDecision` autoriserait un script, si « Qui vend » vaut `team` (ou `both` avec quelqu'un en poste), le code produit un passage `sale` au lieu du script. Il hérite de tout ce qui bloque une offre (drapeaux du fan, risques, fan qui ne sexualise pas). Un `sale` compte comme une offre pour le délai entre deux offres, qu'il aboutisse ou non.
- [ ] Personne en poste : avec `team`, l'agent continue la relation sans vendre, l'occasion est notée dans Suivi et le `sale` part au premier membre qui prend son poste ; avec `both`, l'agent vend.
- [ ] Supervision : rang « important » dans `HANDOFF_CAUSES`, jamais « urgent » ; pas de `protectionFor`, pas d'alerte « Il n'écrit plus à ce fan » (texte propre au `sale`), hors du taux en réel de l'ADR 0019. La ligne À traiter va d'abord au membre en poste (`scheduling.onShift`).
- [ ] Brief de passation : où en est le fan (KYC, notes, drapeaux, dernières dépenses), packs déjà refusés, scripts déjà joués, sans texte de prompt, et un lien direct vers la conversation dans Reveal : le chatteur vend dans Reveal, avec ses outils (ADR 0025).
- [ ] Refus et argent : un refus obtenu par le chatteur s'enregistre comme un refus de l'agent ; un manque d'argent avoué au chatteur pose `salesFrozen` (`money_trouble`) depuis Suivi.
- [ ] Gardes (ADR 0025) : pas de champ libre pour écrire à un fan dans Nirvana ; un brouillon de l'agent que le chatteur valide ou retouche part par le membre « bot » et repasse les gardes dures (G5). Ce que le chatteur tape dans Reveal est hors gardes : c'est sa façon normale de vendre ; écrire ce risque et ce qui le couvre (formation, contrat) dans `docs/conventions/security.md`.
- [ ] Main humaine depuis Reveal (ADR 0025) : un message sortant que l'agent n'a pas envoyé, lu par le connecteur, met la conversation en main humaine ; l'agent se tait sur ce fan jusqu'à « Rendre la main » ou un délai réglé par le propriétaire.
- [ ] Routage (`conversations.routed_to_user_id`, migration 0016) : un événement de routage le pose, « Rendre la main » le remet à `null` (fait : projection de `takeover_ended`) ; un `sale` qui n'a pas été pris à la fin du shift repart au membre suivant en poste, sinon il reste à l'agence dans À traiter. Une conversation routée n'est donc jamais lisible à vie hors shift (ADR 0025).
- [ ] Reprise : `releaseOutcome = sold` → aftercare ; `refused` → pas de bouderie (une seule par refus) ; `none` → reprise normale.
- [ ] Attribution (ADR 0025) : à la détection d'une vente, l'auteur est le membre qui tenait la conversation à `detected_at` d'après le journal : celui qui a pris la passation, ou, quand la main humaine vient d'un message écrit dans Reveal, le membre en poste sur ce compte (l'auteur Reveal si la capture montre quel membre a écrit) ; une conversation que l'agent tenait donne la vente à l'agent, sans commission. Délai de grâce après « Rendre la main » : réglage, 0 par défaut, à confirmer par Charles.

## Critères d'acceptation
- Tests du domaine : fan qui sexualise après le KYC minimum → `sale` ; même fan sous « ventes gelées » → rien ; deux messages d'affilée du fan → un seul `sale` ; un `sale` dans les 10 h d'une offre → rien ; « Qui vend = agent » → comportement actuel inchangé ; une créatrice nouvelle est en `team` ; `team` sans personne en poste → pas de script, occasion notée.
- Test : un `sale` ne déclenche ni `protectionFor` ni l'alerte « Il n'écrit plus à ce fan », et ne change pas le taux en réel.
- Test contre `FakeReveal` : passage, prise en main, vente faite dans Reveal et détectée, attribuée au membre, rendre la main avec `sold`, l'agent reprend avec l'aftercare ; un message humain écrit dans Reveal sans passation fait taire l'agent et la vente qui suit revient au membre en poste.
- Évals : la reprise après une vente faite par un humain reste dans la voix de la créatrice.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Commission sur une vente partagée entre agent et humain (règle unique : celui qui tient la conversation), contrôle qualité des ventes humaines.

## Notes de session
