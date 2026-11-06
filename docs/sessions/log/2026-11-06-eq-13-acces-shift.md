# 2026-11-06 — EQ-13 Accès d'un chatteur borné à son shift (reco 7 de la recette du 05/11)

Fait :
- contrat : `CurrentUser.shiftCreatorIds`, les créatrices de sa liste dont la fenêtre d'accès est ouverte maintenant, jamais dans `creatorIds` ; `ConversationSummary.heldBy` (`you`, `other`, `null`) ;
- `scheduling` : `creatorsInAccessWindow` (domaine, testé : marges, minuit, shift arrêté, marge nulle) et `createShiftAccessReader`, lu par `auth.ts` à chaque requête d'un membre `active` au scope `self`, sur la connexion de l'application (`withMember`, `enterCreator`) : une requête indexée par créatrice de sa liste, la marge lue dedans, l'horloge injectable (`accessClock`), et une lecture qui échoue ferme (aucune créatrice, jamais une erreur) — les trois points de Bilan ;
- `conversations` : liste complète, fiche, fil, journal, courbe, brouillons et prise de main pendant la fenêtre ; hors fenêtre, ce qu'il tient seulement ; « Rendre la main » refusé sur la main d'une autre personne (`holderOf`) ; chaque ouverture par un chatteur écrite dans `audit_log` avant la lecture, une fois par quart d'heure (`openings.ts`, partagé avec l'espace de la créatrice) ;
- « mes shifts » (Aujourd'hui) ne passe plus par la connexion admin : `memberShifts` lit ses shifts comme lui, créatrice par créatrice (point de l'audit RLS de Bilan, relayé le 06/11) ;
- `fans` : le port `FanAccess` remplace `FanRoutedTo` et trace la fiche lue seule (`via` `flags` ou `kyc`) ;
- « À traiter » suit les créatrices du shift ;
- Suivi : « Tu as la main » sur la sienne, la main d'une autre personne avec les conversations sans rien à faire et sans bouton (« C'est à lui de la rendre. »), le lecteur reste ouvert après « Rendre la main » pendant le shift et se ferme hors shift, « Cette conversation n'est plus ouverte pour toi » quand la fenêtre se ferme pendant la lecture, l'écran vide du chatteur en poste ne dit plus que l'accès « n'est pas encore ouvert », le lecteur dit « Tu as la main. Tu réponds dans Reveal… » à celui qui la tient (plus « Un humain… Il répond »), et la carte « Tu n'es pas en poste » ne laisse plus un grand vide au-dessus de la liste ;
- glossaire : « Qui a la main » (`heldBy`), « Créatrices du shift » (`shiftCreatorIds`).

Pas fait :
- ses passations routées en tête de sa file : avec EQ-08.

Décisions :
- un passage à l'humain que personne n'a pris se rend par le chatteur en poste : c'est lui qui y répond, et sans ça la conversation restait en `human` jusqu'au propriétaire ;
- la main d'une autre personne va, pour un chatteur, avec « Rien à faire » ; le propriétaire et un manager la gardent sous « À toi » (CHAT-22) ;
- après « Rendre la main », l'écran relit la conversation : le serveur seul dit si elle lui reste ouverte, aucun calcul de fenêtre dans le navigateur.

Découvertes :
- aucune.

Candidats à suppression : aucun.

Vérifié :
- typecheck API et web, tests web de Suivi (153), domaine `shifts` (24) ;
- intégration `shift-access` (12, nouveau : dont l'horloge injectée et la lecture qui échoue) et toute la suite d'intégration de l'API ;
- `pnpm check` ;
- captures Nuit et Jour, ordinateur et téléphone (20), dans `/mnt/project-files/recette/2026-11-05/corrections/equipe/eq13-acces-shift/`.
