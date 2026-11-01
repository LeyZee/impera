# EQ-13 Accès d'un chatteur borné à son shift
Statut : todo (ID validé par Charles le 27/10/2026, 15h11 : « je les veux tous » ; ADR 0025 acceptée le même jour à 15h28)
Phase : équipe (ADR 0023, ADR 0024, ADR 0025)
Dépend de : ADR 0025, EQ-01, EQ-02 (`onShift`), le filtre des conversations routées (prérequis d'EQ-08 et d'EQ-10), EQ-08 pour les passations `sale`
Branche : task/eq-13-shift-bound-access

## Objectif
Pendant son shift et une courte marge, Nirvana montre au chatteur toutes les conversations des créatrices que son shift couvre (il y valide les brouillons de l'agent et y prend ses passations, puis vend dans Reveal) ; hors de cette fenêtre, Nirvana ne lui montre rien, pour qu'un chatteur qui s'en va ne parte pas avec la mémoire des gros fans.

## Contexte à lire
`docs/adr/0025-chatter-access-during-shift.md` en entier, ADR 0024 (§ Rôles et scopes), `docs/architecture/threat-model.md`, `docs/conventions/security.md`, EQ-02, EQ-08, EQ-10. Le filtre du serveur livré avant EQ-08 et EQ-10 ferme tout par défaut : pour un membre au scope `self`, `currentUser()` vide `creatorIds`, et le chatteur ne lit que les conversations routées vers lui (`conversations.routed_to_user_id`). Cette fiche est celle qui **ouvre**, pendant le shift seulement. Elle borne ce que Nirvana montre, pas Reveal : Nirvana ne ferme pas la session Reveal d'un chatteur (ADR 0025, § Ce que Nirvana ne peut pas faire côté Reveal).

## À faire
- [ ] Garde du serveur (ADR 0025), calculée à chaque requête comme `creatorIds` : pendant un shift (`onShift`) et une marge avant et après réglée par le propriétaire, un chatteur reçoit les créatrices que ce shift couvre dans une liste à part de `CurrentUser`, `shiftCreatorIds` (à côté de `routedCreatorIds`, contrat par le propriétaire de `packages/contracts`), lue seulement par les routes des conversations et des fiches de fans de ces conversations ; jamais dans `creatorIds`, qui ouvrirait aussi le mode, le Dashboard, la persona, la liste des fans et l'écriture des drapeaux. Il lit leur file À traiter, leurs conversations, et pour celles-ci la fiche du fan, sa mémoire et ses Limites du fan (en lecture) ; il valide, retouche ou refuse un brouillon de l'agent, prend une passation, ouvre la conversation dans Reveal par le lien du brief, et rend la main. Aucun champ libre pour écrire à un fan. Jamais le mode de l'agent, la persona, Entraîner ni les Réglages. Seul un membre au statut `active` la reçoit : un suspendu garde un accès restreint à ses propres données et ne voit aucun fan, même avec un shift encore au planning, et un parti n'a plus de connexion (carte de Charles du 28/10, 22 h 37, ADR 0024).
- [ ] L'accès suit le shift prévu, pas la prise de poste (EQ-12) : un oubli de prise de poste ne bloque pas un chatteur.
- [ ] Une passation qu'il a prise reste lisible par lui seul jusqu'à « Rendre la main », même après la fin de la fenêtre.
- [ ] **Question ouverte, posée à Charles le 29/10** (découverte de la relecture de #318) : aujourd'hui, un membre qui quitte `active` (en congé, malade, en déplacement, suspendu) garde la lecture des conversations déjà routées vers lui (`routedCreatorIds`) jusqu'à la fin de la passation, ce qui contredit le critère « un membre suspendu ne lit ni fan ni conversation ». Recommandation : à la sortie du statut `active`, ses passations sont rendues comme un « Rendre la main » sans issue (`none`), avec une note qui dit le statut, puis routées comme d'habitude, comme au départ (EQ-14). Correctif côté conversations par leur propriétaire dès l'accord de Charles.
- [ ] Ses passations routées passent en tête de sa file (EQ-08).
- [ ] Hors fenêtre, le chatteur garde Aujourd'hui, Planning, Commissions et Moi ; Suivi affiche un état honnête (« Tu n'es pas en poste »), jamais une erreur.
- [ ] Aucun export de liste de fans pour un chatteur ; chaque lecture d'une fiche de fan par un chatteur entre au journal (`audit_log`), sans le contenu de la fiche.
- [ ] Index sur les shifts d'un membre pour que la garde reste rapide à chaque requête (migration par le propriétaire de `packages/db` si besoin).

## Critères d'acceptation
- Tests d'intégration : hors fenêtre, un chatteur ne lit ni fan ni conversation de sa créatrice ; pendant son shift et dans la marge, il les lit et peut valider un brouillon ; il ne lit jamais une créatrice que son shift ne couvre pas ; une passation prise reste lisible jusqu'à « Rendre la main » ; le manager actif n'est pas borné ; un manager non actif l'est ; un shift de nuit à cheval sur minuit ouvre l'accès sur toute sa durée.
- Un shift retiré ou raccourci ferme l'accès à la requête suivante, sans attendre une nouvelle connexion.
- Pendant son shift, la file « À traiter » et les Limites du fan de ses créatrices répondent au chatteur, côté serveur, avec ce qu'elles montrent au manager ; hors fenêtre, elles disent « Tu n'es pas en poste », jamais une panne (constat Suivi G5 de la recette du 28/10 : un chatteur en poste lisait une file vide et « Le serveur ne répond pas », #285 n'a corrigé que les textes).
- Un membre suspendu avec un shift en cours ne lit ni fan ni conversation.
- Pendant son shift, le chatteur reçoit toujours 403 sur le mode de l'agent, le Dashboard, la persona, la liste des fans et l'écriture d'un drapeau (sauf « ventes gelées » sur sa passation, EQ-08).
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Filigrane, détection de copie d'écran, changement du mode de l'agent par un chatteur.

## Notes de session
- 2026-10-27 (fil Extension) : Suivi d'un chatteur hors de sa fenêtre d'accès (`MyShifts`, ADR 0025) dit « Tu n'es pas en poste » avec son prochain shift et l'heure où ses conversations s'ouvrent, au lieu d'une liste vide ; les passations qui lui sont adressées restent dessous. Tant que `/v1/scheduling/my-shifts` ne répond pas, Suivi reste tel qu'avant.
- 2026-10-29 (fil Équipe, passe sur les fiches) : ajoutés depuis la recette du 28/10 la file « À traiter » et les Limites du fan du chatteur en poste (Suivi G5, partie serveur restante) et la règle du membre suspendu (carte de Charles du 28/10, 22 h 37). Ordre : après EQ-06.
- 2026-10-31 (fil Équipe, passe sur les fiches) : ajoutée la question des passations d'un membre qui quitte `active` (relecture de #318), en attente de Charles.
