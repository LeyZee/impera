# P3-12 Note de désir : la tension sexuelle de chaque fan, et ne vendre que quand elle est haute
Statut : in_progress (ID validé par Charles le 27/10 à 20h37, carte « Les 5 sans capture, désir en tête » ; idée retenue par Charles à 20h24 : « plus la note est élevée, plus on peut passer à l'action et vendre des médias »)
Phase : 3 (politique de l'agent)
Dépend de : P3-09 (curseur de sexualisation, livré), `offerDecision` (livré), P3-02 (mémoire et limites du fan) ; la ligne de la note Reveal attend la capture (`setFanNote`) ; la règle « pendant une vente » attend P6-01 et P6-02 ; le reste se code sans capture ni clé
Branche : task/P3-12-desire-score

## Objectif
Chaque fan a une note de désir de 0 à 100, calculée par le code à chaque message à partir de signaux fermés, qui monte quand il s'échauffe et retombe quand il refroidit ou se tait. La politique s'en sert pour décider quand elle ouvre l'intime et quand un script peut partir ; le Suivi la montre avec ce qui l'a fait bouger.

## Contexte à lire
`apps/api/src/modules/agent/domain/sexualization.ts` (`sexualizationDecision`), `policy.ts` (`offerDecision`, `offerSignals`, `NO_SALE_RISKS`), `packages/llm/src/schemas.ts` (`BriefSchema`), `packages/contracts/src/persona.ts` (`strategies`, `PERSONA_BOUNDS`), le port `ComposeInput` du module `conversations`, `apps/web/src/agent/causes.ts`, `docs/architecture/ai-engine.md` (Le Brief, La politique), `docs/design/README.md` (graphiques, néon), ADR 0018, 0021, 0023, 0024, 0025, méthode de chatting §2 et §3 (hors dépôt), `docs/reference/desirely-analysis.md` (§ Conversations).

## Ce que fait Desirely
Un niveau de désir par conversation, affiché en colonne dans la liste des conversations, lié à ses phases (accroche, montée, vente, après-vente). Leurs niveaux s'appellent neutre, joueur et acheteur ; le centre d'aide montre le niveau, pas sa formule. Chez nous, les bandes s'appellent **neutre, joueur, chaud** (glossaire, `desire_band` : `neutral | playful | hot`), et la formule est du code, lisible et testée.

## Règle de fond
**La note ne fait que retenir.** Elle remplace une condition existante (« il sexualise maintenant ») par une condition plus exigeante et n'en lève aucune autre : âge déclaré par le fan, KYC minimum, « rien d'explicite », délai entre deux scripts, budget nul, gel, risques et `doNotContact` passent toujours avant. Une note haute ne lève jamais un délai ni une garde. Le modèle ne donne jamais le nombre : il relève des signaux dans une liste fermée, le code compte (règle 3).

## Calcul
1. **Signaux lus par le cerveau**, nouveau champ `desireSignals` du Brief (tableau d'énumérations fermées, quelques tokens), sur le dernier message du fan seulement :
   - qui réchauffent : il ramène lui-même vers l'intime (`steers_to_intimate`), compliment physique ou sensuel (`body_compliment`), question sur son corps ou sa tenue (`asks_about_her_body`), il dit ce qu'il désire ou ressent (`states_desire`), langage explicite (`explicit_language`), réaction chaude à un média ou un teaser (`hot_media_reaction`), jeu de rôle (`roleplay`) ;
   - qui refroidissent : il change de sujet (`changes_subject`), réponse sèche (`cold_reply`), contrainte du moment (travail, pas le temps, quelqu'un à côté : `busy_now`), il freine ou refuse (`slows_down`), gêne (`discomfort`) ;
   - les signaux déjà rendus par le Brief entrent aussi dans la note : intention `flirt`, `sexting` ou `asks_for_media`, sentiment `aroused`. C'est ce qui permet à `low_desire` de remplacer `not_sexualizing` (ci-dessous).
2. **Signaux mesurés par le code, sans modèle** : longueur de sa réponse rapportée à sa médiane, calculée sur l'historique déjà passé au composeur (50 messages, sans nouvelle statistique) ; vitesse de réponse (moins de deux minutes : plus ; plus d'une heure : moins) ; emojis suggestifs pris dans une liste fermée en code (🔥 😈 😏 🥵 💦 🍑 🍆 👅 🤤) ; messages à la suite sans attendre sa réponse.
3. **Cumul et retombée** : chaque message du fan ajoute ou retire des points selon des poids versionnés en code (`DESIRE_WEIGHTS_VERSION`), bornés à 0 et 100. Sans message de lui, la note retombe de moitié toutes les 90 minutes vers un plancher : 0, ou 20 s'il a acheté dans les sept derniers jours (lu dans `sales`, à 0 tant que P6-01 manque). La retombée se calcule **à la lecture**, depuis `desire_at`, par la même fonction pure, sans job : le moteur et l'API du Suivi l'appliquent, l'écran n'en calcule rien. Un message de la créatrice ne fait jamais monter la note.
4. **Trois bandes** : neutre (0 à 39), joueur (40 à 69), chaud (70 à 100).
5. **Risques** : un risque de `NO_SALE_RISKS` fige la note et la met hors jeu ; `minor_suspected` ou `ageDisputed` la remet à 0.
6. **Qui calcule, qui écrit** :
   - `ComposeInput` gagne `desire?: { score, at }`, lu dans la projection de la conversation (port `conversations`, en ajout, Bilan) ;
   - le moteur (fonction pure `desireScore`) calcule la nouvelle note et la rend dans son résultat ; l'agent n'écrit jamais le journal lui-même ;
   - le worker écrit l'événement `desire_scored` (note avant, note après, signaux, version des poids) **dans la transaction qui tient la projection, chaque fois que la note change**, et rien quand elle ne bouge pas ; la projection sur `conversations` (`desire_score`, `desire_band`, `desire_at`, migration additive attribuée par Bilan) suit ces événements. Une reconstruction des projections (`rebuild-projections`) retrouve donc exactement la note que la politique a lue (relecture de Bilan, 27/10).

## Avec le curseur (P3-09) et `offerDecision`
- **Ouvrir l'intime elle-même** (`sexualizationDecision`) : la note doit être au moins au seuil d'ouverture (`strategies.sexualization.min_desire_to_open`, défaut 40), en plus des conditions actuelles de `no_opening` (âge confirmé, pas de `noExplicit`, délai `initiate_after_hours`). La branche « il amorce » ne change pas : elle reste celle de P3-09 (âge déclaré, KYC minimum, `noExplicit`).
- **Proposer un script** (`offerDecision`, ordre réel : `do_not_contact` → `risk` → `sales_frozen` → `age_unconfirmed` → `fanAsksForPaid` → `no_budget` → `cooldown` → `not_sexualizing`) : le motif **`low_desire` remplace `not_sexualizing`**, à la même place, après le délai : un script ne part que si la note est au moins au seuil de la créatrice (`strategies.script_launch.min_desire`, défaut 70). Un fan qui demande lui-même du payant (`fanAsksForPaid`) passe comme aujourd'hui avant le budget nul, le délai et donc la note ; jamais avant un risque, un gel autre que `money_trouble`, ni l'âge.
- **Persona** : `min_desire_to_open` et `min_desire` sont **optionnels avec leur valeur par défaut**, pour que les YAML existants restent valides (`strictObject`) ; deux bornes dans `PERSONA_BOUNDS` : `sexualizationMinDesireToOpen: [20, 70]`, `scriptMinDesire: [50, 90]`.
- **Pendant une vente** (après P6-01 et P6-02, qui créent l'état « en vente ») : si la note retombe sous 40, la conversation revient au relationnel (règle « vente qui s'enlise » de `PROPOSED-sale-steps-rules.md`).
- **Le composeur** reçoit la décision de la politique et la bande comme indication de ton, jamais le nombre ; rien de la note n'est dit au fan.

## Où elle se voit
- **Suivi** (propriétaire, manager ; chatteur pendant son shift seulement, ADR 0025) : dans la liste, la bande en mot seulement (`ink-muted`), sur une jauge neutre pour les trois bandes. Ni rouge ni néon : c'est la même lumière que les urgences (`docs/design/README.md`), et une teinte par ligne ferait de la liste une carte de chaleur. Le tri « chauds d'abord » est un choix de l'utilisateur, jamais l'ordre par défaut : « À traiter » reste en tête.
- **Lecteur de conversation** : la courbe de la note au fil des messages, dessinée comme les graphiques du design system (série en `data-1`, grille `hairline`, jamais deux rouges). Le détail d'un point s'ouvre au survol et au toucher, et dit les signaux en mots (« il ramène vers l'intime, réponse longue, emoji suggestif ×2 : +14 ») ; leurs libellés français vivent à un seul endroit, comme `agent/causes.ts`.
- **Persona** : les deux seuils se règlent dans l'écran Persona, onglet Stratégies ; l'onglet et l'adresse sont réservés au propriétaire (leçon de #217 : sinon un manager ou une créatrice voit un 403 affiché comme « Le serveur ne répond pas »).
- **Note du fan dans Reveal** : une ligne « Désir : chaud (72), 27/10 21 h 14 », écrite seulement quand la bande change, derrière la garde d'écriture (`connector_config.writes`, ADR 0018), pour les chatteurs qui travaillent dans Reveal.
- **Jamais** chez la créatrice (ADR 0023), jamais sur Telegram avec des données du fan (ADR 0020).

## À faire
- [x] `desireSignals` dans `BriefSchema` et le prompt du cerveau (le message du fan reste une donnée, règle 4) ; relecture Bilan pour `packages/llm` et `packages/contracts`.
- [x] `agent/domain/desire.ts` : `desireScore(previous, signals, measured, now)` pur, avec la retombée, les poids et la liste d'emojis versionnés ; tests.
- [x] Champs de persona optionnels `min_desire_to_open` et `min_desire`, bornes dans `PERSONA_BOUNDS`, valeurs de la persona `personas/demo`.
- [x] `sexualizationDecision` (seuil dans `no_opening`) et `offerDecision` (`low_desire` à la place de `not_sexualizing`). Aucun écran ne montre aujourd'hui pourquoi une offre est refusée (`causes.ts` ne porte que les causes de passation) : le libellé de `low_desire` viendra avec cet affichage.
- [x] `ComposeInput.desire`, `desire` sur les résultats `draft` et `held`, projection, événement `desire_scored` écrit par le worker, migration 0022 (Bilan, #221).
- [x] Le moteur rend `desire` avec chaque résultat calculé sur un message du fan (Agent).
- [x] Lecture du Suivi (Bilan) : le DTO donne la note déjà retombée côté serveur (`desireNow`), ou `null` avant la première, et l'API rend les points de la courbe (les `desire_scored`). Extension ne code l'écran qu'une fois cette lecture exposée. Fait : `ConversationSummary.desire` (`{ score, band } | null`) et `GET /v1/conversations/{id}/desire` (`DesireCurveSchema`).
- [ ] Affichage dans le Suivi et le lecteur, un libellé par code de `DESIRE_SIGNALS` ; réglage des seuils dans l'écran Persona, qui montre dans quelle bande tombe chaque seuil (Extension).
- [ ] Plancher d'achat (20 après un achat dans les sept jours) avec P6-01 : une seule source lue par le moteur (`desireScore`, `floor`) et par la lecture du Suivi (`DESIRE_FLOOR` de `conversations/infra/db/reader.ts`), sinon la liste et la politique lisent deux notes (remarque sur #225).
- [ ] Ligne de la note Reveal (après la capture, contre `FakeReveal` d'abord).
- [ ] Calibration hors dépôt sur le corpus de vente (`/mnt/project-files/onlychat/corpus-vente/`) : la note juste avant chacune des ventes et avant chaque refus ; les chiffres agrégés vont au journal, jamais un message.

## Critères d'acceptation
- Tests du domaine : retombée à mi-vie calculée à la lecture ; bornes 0 et 100 ; un message de la créatrice ne fait rien ; risque qui fige ; `minor_suspected` qui remet à 0 ; un événement par changement de note et aucun quand elle ne bouge pas ; `rebuild-projections` retrouve exactement la note lue par la politique.
- Test par propriétés sur `offerDecision` : aucune offre sans âge confirmé ni sur un risque, quel que soit le reste ; sous budget nul ou pendant le délai, une offre seulement si `fanAsksForPaid` ; sous le seuil de désir, une offre seulement si `fanAsksForPaid`.
- Les YAML de persona existants passent sans les nouveaux champs.
- Évals : fan qui s'échauffe sur dix messages (l'offre n'arrive qu'en bande « chaud ») ; fan qui flirte une fois puis parle de son travail (aucune offre) ; fan chaud qui dit « je suis au boulot » (la note baisse, pas d'offre).
- Écrans : Nuit et Jour, 1 440 et 400 px, mouvement réduit, état « Le serveur ne répond pas ».
- `pnpm check`, `pnpm test`, `pnpm evals` sans régression.

## Hors périmètre
Le routage vers un chatteur selon la note (`PROPOSED-hybrid-routing-by-value.md`), les autres colonnes du Suivi (`PROPOSED-tracking-sales.md`, qui lit cette note).

## Notes de session

27/10 soir (fil Agent) : part moteur livrée. `desireScore`, `desireNow`, `measureDesire` dans `agent/domain/desire.ts` (poids `desire-1`, `busy_now` à −30 pour qu'un fan chaud au travail sorte de « chaud ») ; le moteur rend `desire` (avant, après, bande, signaux, version) seulement quand la note bouge et ne recompte jamais un message déjà compté (`desire.at` ≥ son dernier message) ; playground (`désir` dans la trace) ; évals : `situation.desire`, `desire_signals_contain`, `desire_band_in`, trois scénarios `full`. Reste : contrat, worker, projection et migration (Bilan), écrans (Extension), ligne de la note Reveal, calibration.
