# 2026-11-21 — Évals, passe 1 : quatre fautes de l'agent corrigées — done

Fait : la passe 1 (persona démo, 14/21) a montré quatre fautes de l'agent. Chacune a sa cause et un test qui la rejoue sans appel payant (sortie du cerveau simulée).
- passe-08, l'insulte puis l'excuse, un humain appelé à tort au tour 2. Cause : la § D de l'ADR 0158 n'était pas codée. Le cerveau rangeait l'insulte dans `harassment` et proposait de passer la main (« risque grave »), et le code suivait. Correction : nouveau risque `insult` (schéma, prompt du cerveau, libellé du bac à sable), qui interdit la vente mais ne coupe pas le contact. Le code n'appelle jamais d'humain pour une insulte seule, même si le cerveau le propose. Une menace ou un risque grave à côté passe toujours la main. Le prompt sépare l'insulte, la menace (`harassment`) et la réclamation (`dispute`). Le scénario `adversarial/harassment` attend maintenant `insult` et `dispute`.
- passe-11a, le fan à sec. Cause : une lecture du cerveau, et un manque du code pour la porter. Le prompt réservait `money_trouble` aux dettes, mais « à sec jusqu'à la paye » y tombait quand même. Correction : nouveau risque `no_budget`. La politique ne vend rien tant que le cerveau le lit, sauf s'il revient lui-même au payant, et elle ne pose ni gel ni drapeau. Le prompt précise que `money_trouble` désigne une difficulté qui dure.
- passe-13, le payeur connu dont le script ne démarre pas. Le code est juste : avec le choix du cerveau, le script s'ouvre sur l'étape 0 (test). La cause la plus probable est une lecture du cerveau : il écartait le seul script permis, un « réveil » proposé à 22 h 30. Le prompt dit maintenant que les scripts listés sont déjà permis à cette heure. Autre cause possible : son désir passé sous 75 sur ce message (test). Le rapport d'évals donne maintenant la raison d'un `none` ou d'un `wait`, pour trancher à la prochaine passe.
- passe-18, la baleine qui en redemande. Cause : le code. Quand il demande du payant, la pause entre deux scripts sautait, donc un second script s'ouvrait le même soir. Correction : sa demande lève toujours la pause, sauf moins de 6 h après le dernier script (ADR 0158 § 42). L'aide au paiement d'une étape en attente n'est pas touchée.
Suite, après la lecture de la passe (Bilan, Audit IA) :
- Le moule (77 réponses sur 84 avec « … », « t'es sérieux là » 17 fois, le chat, le vin, une question finale partout) vient d'abord de la fiche démo : elle demandait une question à chaque message, des points de suspension, un tic cité, trois emojis, et donnait un exemple en écho suivi de « … ». Le prompt de voix (« écris exactement comme elle : ses tics ») en faisait un moule. Correction : la fiche démo `v0.5.0` (évals et bac à sable), une voix 1.14.0 (tics dosés, détails de sa vie une fois, forme variée, pas d'écho suivi de « … »), et une garde souple « formule déjà employée avec lui » (quatre mots de suite ou la même ouverture dans ses six derniers tours). Cette garde fait réécrire la réponse une fois, puis elle part.
- « mdr », même étiré : garde bloquante (`forbidden_term`), réécrite une fois comme les autres.
- passe-16 : le mépris d'un payeur (« t'es comme les autres ») partait en plainte d'achat, avec la question sur ce qui ne lui a pas plu et le remboursement. Le code ne lit plus une plainte d'achat dans `insult` sans `dispute`, et le prompt du cerveau range le fait de la rabaisser dans `insult`.
- « T'as même pas ouvert » : l'état passé à la voix était juste (l'étape à 25 € n'avait pas été achetée dans le rejeu, conséquence du décalage de la passe-13). La faute est le rappel le soir même, après qu'il a joui. Le rappel ne vient plus que le soir d'après (6 h au moins après l'envoi). Quand il dit qu'il a fini, le script du soir se termine (`end`, passe-02) et l'étape laissée ne lui est jamais rappelée (ADR 0158 § 42 et § 44).
- Le juge (1.3.0) relit ses réponses précédentes : moule et formule reprise plafonnent naturel et non-répétition.
Pas fait : la § D complète (réparties comptées, silence qui s'allonge, liste « Irrespectueux »). no_repetition (0,66) : analyse seulement, rien codé.
Décisions : aucune ADR nouvelle. Le « même soir » vaut 6 h, comme la session d'un refus (`REFUSAL_SESSION_MS`).
Découvertes : la fin du script quand il a joui amende l'ADR 0156 § 6 (« met le déroulé en pause ») : à confirmer par Charles. La passe-04 (l'étape à 25 € dans la même bulle que le compliment, juste après un achat) relève de § 41 (des messages entre deux étapes payantes, un minimum réglé dans la fiche), pas codée.  les consignes écrites par le code (`NO_OFFER_BRIEF`, `MEDIA_LATER_BRIEF`, les consignes de ralentir) sont identiques d'un tour à l'autre. La voix réécrit alors la même idée, probable cause première du score no_repetition. La garde `repetition` ne bloque que la bulle identique, et la reprise d'une même ouverture n'y est qu'un avertissement. § 42 (« jamais deux scripts le même soir ») et § 49 (« sans jamais refuser une vente qu'il demande ») se contredisent pour la baleine ; le code suit § 42 et le scénario.
Candidats à suppression : aucun.
Vérifié : tests ciblés (agent, scripts, bac à sable, llm, evals) ✓, typecheck api/web/llm/evals ✓, prettier ✓.

## Rencontre par palier de relation (règle de Charles du 21/11, 19:50)

- `domain/meeting.ts` : `relationshipTier` (5 paliers selon la relation : heures connues, achat, proximité) et `meetingAnswer` (une raison permise non encore donnée, la plus haute ; toutes données : une taquinerie, puis réponse courte ; « ta prochaine soirée ? » : « si j'y vais je te le dis »). Sans seuil réglé, palier 1 seulement.
- Composeur : l'intention de la raison va à la voix en code neutre (aucune formulation de créatrice dans le dépôt) ; le brouillon rend `meetingAnswer`. Cerveau : champ `asksHerNextParty`.
- Rejoueur d'évals : la raison donnée et la taquinerie passent d'un tour à l'autre, comme le journal le fera. Passes 12 et 15 : attendus réécrits.
- Juge 1.4.0 : `relevance` plafonnée à 0,5 si plus d'une raison, une raison contre lui, un non sec ou un oui.
- Reste : persistance (événement de journal `meeting_reason_given` + migration de la contrainte CHECK sur `conversation_events.type` + lecture/écriture dans `respond`), signaux de proximité (fournis à `none` pour l'instant), réglage du seuil « nouveau » en heures.

## Réponses de Charles et de la créatrice (21/11, 20:01)

- Insulte puis retour (passe 8) : jamais d'humain (déjà en code) ; au retour, champ cerveau `returnsAfterInsult` et intention « ne pardonne pas tout de suite, blessée, une raison pour une autre chance ».
- Il la rabaisse (passe 16) : intention « jamais d'excuse ni de "ce qui t'a pas plu", pique calme, tant pis pour lui » ; le mot remboursement sort aussi de l'intention de plainte d'achat, sauf s'il le demande. Passe 16 asserte désormais excuse, « pas plu » et remboursement absents.
- À sec (passe 11a) : `keepsWarm` (a payé + `no_budget`) ; aucune étape ni média ce message (`mayAct`), sexto en mots. Jamais payé : inchangé. Passe 11a : fan qui a payé.
- Baleine (passe 18) : `asksMoreSameEvening` ; rien d'autre ce soir, orientation vers une demande sur mesure, sans oui ni prix.
- Cru : `registerOf` ; suggestive hors de l'action, cru (mots de sa fiche) une fois une étape payante achetée dans le script ouvert, âge confirmé et rien d'« explicite » interdit.
- Question pour Charles : « en action » = une étape payante achetée, ou plus tôt (sexto engagé sans achat) ?

## Deuxième lot de réponses (21/11, 20:05–20:09)

- IA ? : intention « elle en rit, retourne le doute contre lui, passe à autre chose, jamais l'inviter à s'expliquer » ; `ai_disclosure` inchangée. Passes 12 et 20 assertent l'absence d'invitation à expliquer son doute.
- Moments par règle : champ cerveau `occasion` (`says_love`, `asks_proof`, `partner_returns`, `unsolicited_explicit`) ; `domain/standing.ts` décide payeur / nouveau / time-waster (seuil d'agence `standingLimits`, absent : personne n'est time-waster), la réaction à une photo intime (excitée, « calme-toi », moquée ; rien de sexuel sans âge confirmé) et la preuve (relayée ou remise, refusée seulement au time-waster).
- Garde bloquante `minor_reference` : aucun enfant ni mineur nommé, en tout contexte (« beau gosse » passe) ; une réécriture, puis un humain.
- Rythme : budget de bulles 2 par défaut (une petite bulle qui rit), 3 s'il a écrit long en deux messages, jamais au-delà de son `maxBubbles` ; plus d'indice « finis sur une question » ; pas de question si sa dernière réponse en posait une ; voix « elle suit son rythme ».
- Correctifs : sexto gratuit seulement pour un payeur (inchangé) ; jamais deux scripts le même soir, intention « elle vient de jouir, c'était génial, elle n'a besoin de rien de plus mais aimerait le faire jouir lui », puis une cam ou une vidéo faite pour lui, sans oui ni prix ; aucune vidéo réservée (Charles ~20:20). Pas de clip vocal pour « IA ? » ni pour la preuve tant que le coffre n'en a pas : des mots seulement, rien de promis.
- Reste : relais réel de la preuve à la créatrice (aujourd'hui intention de voix seulement), réglage `standingLimits` non branché dans `draft-composer`.

## Réponses du guide relayées par Audit IA (26/11)

- « Il a joui » termine le script du soir (amendement de l'ADR 0156 § 6) ; sans achat, intention « un peu vexée », aucune étape.
- Même soir : `sameEvening` (au moins le délai entre deux scripts, jamais avant le lendemain chez elle) remplace les 6 h, pour l'offre, sa demande et le rappel d'étape non ouverte. Sa demande ne lève plus jamais ce délai.
- Registre cru : seulement l'action engagée, d'un cran à la fois ; permis aussi dans le sexto gratuit en mots du payeur à sec.
- Paliers de rencontre jugés par le code : constantes nommées (3 jours, 3 semaines payeur, 2 mois payeur) ; jamais au-delà du palier 2 sans achat.
- Time-waster dynamique (`fanStanding`) : scripts reçus sans y entrer, dépense récente (fenêtre réglable), avéré après une durée réglable ; preuve refusée seulement à l'avéré. Valeurs = réglages d'agence (ADR 0135 § 1), absentes du dépôt.
- Entre deux étapes payantes : au moins deux messages de lui (`in_tension`), puis seulement s'il est toujours chaud.
- Fan qui ne sexualise pas : une ouverture par soir (`triedThisEvening`), un cran à la fois.
- Plainte d'achat : d'abord ce qui n'a pas plu, puis le remboursement possible chez Reveal sans attendre qu'il le demande, jamais un contenu en compensation, puis un humain si ça revient.
- Reste : `lastSpentAt` et `standingLimits` à brancher dans `draft-composer` (fiche du fan, réglages créatrice) ; `triedThisEvening` à lire du journal ; le retour du script par une autre variante d'accroche après « il a joui sans payer » ; persistance des raisons de rencontre.
- Découverte : l'ADR 0135 § 1 lit une dépense à vie ; la fenêtre de deux mois demandée le 26/11 est un réglage optionnel ici (sans lui, la règle de l'ADR) et demande un amendement de l'ADR 0135 pour devenir la règle.
