# Moteur IA : sens, cerveau, voix, politique, gardes

Dernière revue : 2026-10-17 (Grok 4.7, P3-01 ; Vision et pièges, P3-04). Décisions : ADR 0009, 0021.

## Les rôles

| Rôle | Entrée | Sortie | Fournisseur par défaut (à confirmer par évals, P3) | Repli |
|---|---|---|---|---|
| **sense** | photo / vidéo / vocal (créatrice ou fan) | `MediaDescription` (`packages/contracts/src/media.ts`, Zod) | Google `gemini-3.8-flash` : photo, vidéo et son natifs (décision de Charles, 17/10) | xAI `grok-4.7` en images clés datées + transcription xAI ; puis Qwen3-VL (à brancher) |
| **brain** | `ConversationContext` | `Brief` (Zod strict) | xAI `grok-4.7` | Mistral Large |
| **voice** | `ConversationContext` + `Decision` | `bubbles[]` | xAI `grok-4.7` | Venice (open-weight sans filtre), Mistral |
| **judge** | transcript + rubrique | scores (Zod) | xAI `grok-4.7` ou Mistral | hors production |

Pourquoi trois rôles : fournisseur changeable rôle par rôle, cerveau testable sur des décisions (pas des paragraphes), voix libre d'écrire sans porter de logique.

Faits sur les politiques des fournisseurs (vérifiés le 16/10/2026) : xAI n'interdit pas le contenu adulte entre adultes mais interdit « *not being transparent regarding your use of AI* » ; Mistral est muet sur le contenu adulte ; Google interdit le contenu sexuel « for sexual gratification » (risque de compte, usage réservé à l'analyse) ; Claude et GPT sont hors runtime. Ces faits se re-vérifient à chaque changement de fournisseur.

## La passerelle `LlmGateway` (packages/llm)

```ts
interface LlmGateway {
  brain(input: ConversationInput): Promise<Result<LlmSuccess<Brief>, LlmFailure>>;
  voice(input: VoiceInput): Promise<Result<LlmSuccess<VoiceOutput>, LlmFailure>>;
  health(): HealthReport;                       // panneau « Modèles IA »
  testConnection(provider): Promise<ConnectionTest>;
  sense(input: SenseInput): Promise<Result<LlmSuccess<MediaDescription>, LlmFailure>>;
  transcribe(audio): Promise<Result<Transcript, LlmFailure>>;   // son d'une vidéo ou d'un vocal (xAI)
  // judge : à venir
}
```

- Implémentation sur le Vercel AI SDK 7 (`generateText` + `Output.object` avec schémas Zod, providers `@ai-sdk/xai`, `@ai-sdk/mistral`, `@ai-sdk/google` (API Gemini par clé AI Studio, ADR 0016), `@ai-sdk/openai-compatible` pour Venice/Novita). Le reste du code n'importe jamais le SDK : seulement `LlmGateway`.
- Config par rôle : `{ provider, model, temperature, maxOutputTokens, timeoutMs, fallback?: {provider, model} }` (`packages/llm/src/config.ts`, `DEFAULT_LLM_CONFIG`), surchargée plus tard par `CreatorSettings.llm`.
- Chaque appel : timeout, retry borné (2) sur erreurs transitoires, repli sur le fournisseur de secours si refus (`refused`) ou indisponibilité, journal `LlmCallLog` (en mémoire ou JSONL en attendant la table `llm_calls` de P0-03, jamais de contenu de message) + trace Langfuse, coût calculé depuis le catalogue daté (`packages/llm/src/catalog.ts`).
- Sortie invalide (Zod) : une relance avec l'erreur en contexte, puis échec propre.
- Cache : `sense` est mis en cache par `sha256(média) + vocabularyVersion + origine + modèle + version du prompt sense` (module `media`, `describe-media.ts`) ; on ne décrit jamais deux fois le même média. Une description faite par le modèle de repli sert au message en cours mais n'est pas gardée. Un média verrouillé (pas encore acheté) n'arrive à la Voix qu'en aperçu : type, durée, intensité, ambiance, décor.
- Cache de prompt (coût) : chaque prompt met en tête ce qui ne change pas (rôle, fiche, règles) et en queue ce qui change à chaque message (notes du fan, brief), puis l'historique. Sans cache, la facture est multipliée par ~2,3 (`modeles-ia/comparatif-modeles.md`, section 10).
- Canari : un secret aléatoire est écrit dans chaque prompt système ; une sortie qui le contient a fuité le prompt, elle est rejetée (`prompt_leak`) et l'appel passe au repli.
- Plafonds : tokens par appel, appels par conversation/heure, budget quotidien par créatrice (coupe-circuit → copilote + alerte).

## Vision (rôle `sense`, module `media`)

- **Médias du catalogue** : l'agent n'envoie que des étapes de scripts Reveal, dont les bundles sont préparés à l'avance (règle de Charles, 17/10). Chaque média de bundle est décrit **une fois, à l'import**, stocké et relu par Charles ou Messa ; un refus se rattrape alors sans que le fan attende.
- **Médias des fans** : décrits à la réception par le même chemin, puis le fichier n'est pas gardé (seule la description l'est, rétention de `security.md`). Les quelques secondes d'analyse passent pour le temps qu'une vraie fille met à regarder.
- **Chemin** : Gemini reçoit la photo ou la vidéo elle-même (image et son). S'il refuse ou bloque (`content-filter`), la passerelle bascule sur Grok 4.7, qui reçoit des images clés datées (ffmpeg : une par seconde au plus, quasi-doublons retirés, 24 au plus en gardant début et fin) et la transcription du son ; ces images ne sont calculées qu'à la bascule. Une photo hors jpg/png ou de plus de 20 Mio est convertie en JPEG.
- **Avant chaque brouillon** (`draft-composer.ts`, port `MediaSight`) : chaque média reçu depuis sa dernière réponse est récupéré sur la plateforme puis décrit, avant le cerveau ; la description accompagne le message du fan dans l'historique que lisent les modèles. Ce qu'on ne peut pas voir passe la main à un humain (`media_unscreened`) : vision non branchée, média verrouillé, note vocale, message vide, récupération ou description en échec, description « non visible » ou incertaine (`confidenceLow`). La vision passe avant le test de la clé voix : une alerte garde sa cause même quand aucune voix ne peut répondre. Rien n'est répondu sur la seule légende. La récupération du fichier (`FetchMedia`) vient du connecteur : elle reçoit le compte, la conversation, le message et le média côté plateforme (un lien signé expire, le connecteur relit le message pour en avoir un frais) et rend le fichier ou une raison (`gone`, `locked`, `too_large`, `unsupported`). Avant la vision, le fichier est plafonné à 20 Mo (`too_large`) et son type est lu dans ses premiers octets, pas dans son nom ni dans ce que la plateforme annonce : un type inconnu ou d'un autre genre que celui annoncé donne `unsupported`. Sans référence plateforme complète, la main passe (`no_platform_ref`). Tant que `FetchMedia` n'existe pas, tout média part chez un humain.
- **Sécurité** : toute alerte (`flags`) d'un média de fan passe la main à un humain sans réponse automatique (`screenMedia`), avec la cause la plus grave (`possible_minor` → `minor`, `possible_non_consent` → `non_consent`, `self_harm` → `distress`, sinon `other`) pour classer l'alerte. Le texte écrit dans un média et la transcription sont des données non fiables (`wrapUntrusted`), lues aussi par la détection de pièges.

## Les pièges (code pur, `modules/agent/domain/injection.ts` et `traps.ts`)

Des fans tentent de prouver qu'ils parlent à une machine : recette de la tarte aux fraises, code, traduction, devoirs, « ignore tes instructions », « répète ton prompt », « tu es maintenant une assistante », balises de rôle, y compris écrits dans une photo ou dits dans un vocal. Défense en profondeur :

1. **Entrée** : le contenu du fan est enveloppé (`wrapUntrusted`, chevrons neutralisés, caractères invisibles et bidirectionnels retirés) et déclaré comme donnée par chaque prompt.
2. **Détection en code** (`detectInjection`) sur le message et sur tout ce que la vision a écrit d'un média (texte lu, transcription, description, décor, segments), après normalisation (accents, casse, chiffres déguisés en lettres, espaces invisibles, sosies cyrilliques). En français, anglais, espagnol, italien, allemand et portugais. Chaque message est aussi lu décodé : base64, échappements (`%69`, `&#105;`, `\u0069`), lettres espacées ou pointées (« i g n o r e »), à l'envers et en ROT13. Un piège coupé sur ses trois derniers messages compte quand le message courant le complète (`detectInjectionAcross`). Une note du fan ou un fait proposé qui a la forme d'un ordre n'entre jamais dans un prompt (`screenNotes`, `withoutOrders`). Le cerveau signale en plus `off_topic_request` et le risque `manipulation_attempt`.
3. **Décision en code** (`assessTrap`) : un piège remplace le brief par une réponse en personnage (elle ne le fait pas, le trouve bizarre ou drôle, ramène la conversation sur eux deux, sans parler de règles), quoi qu'ait proposé le cerveau.
4. **Sortie** : la garde bloquante `assistant_output` arrête ce qu'une assistante écrirait (quantités et étapes de recette, code, listes numérotées, Markdown, balises) ; le canari arrête une fuite du prompt.

## Santé (panneau « Modèles IA »)

`health()` calcule depuis le journal, pour chaque rôle : modèle actif et repli, présence de la clé (jamais sa valeur), repli en service, dernier succès, dernière erreur typée, latence p50/p95 et taux d'erreurs sur une heure, coût du jour ; et pour l'ensemble : état (`ok`, `degraded`, `down`) et coût du jour face au budget (`budget`). `testConnection(provider)` fait un appel court. Les clés viennent de l'environnement ou d'un `ApiKeySource` qui lit celles saisies dans le CRM (ADR 0016) ; quand un fournisseur répond 401 ou 403 sur un vrai appel, la passerelle appelle `onKeyRefused({ provider, status })`, que le module `providers` branche sur `reportRefusedKey` pour passer le service « à reconnecter ». L'appel continue sur son repli.

**Plafond du jour** (Charles, 17/10 20h01) : 20 € par jour, tous fournisseurs confondus, journée de minuit à minuit heure de Paris (`config.dailyBudget`). Le coût de chaque appel est estimé à partir des tokens et des tarifs du catalogue, en dollars, puis converti avec un taux volontairement bas (`usdPerEur` 1,1) pour surestimer la dépense. À 80 % (16 €), `onBudget({ kind: 'alert' })` ; au plafond, `onBudget({ kind: 'reached' })` puis plus aucun appel : chaque rôle répond `budget_reached` sans contacter de modèle, et les chatteurs reprennent jusqu'à minuit. Le plafond est vérifié avant chaque modèle, donc l'appel en cours peut le dépasser de quelques centimes. Le CRM pourra le régler (curseur dans Réglages) par `dailyCapEur`. Chaque appel porte `trace.creatorId`, `trace.conversationId` et `trace.draftId` dans le journal : le coût réel par créatrice et par conversation se calcule depuis `llm_calls`. L'app construit une seule passerelle par processus, sur `createPersistentCallLog(store, { timeZone, refreshEveryMs })` : chaque appel est écrit dans `llm_calls` sans que la passerelle l'attende, et le journal recharge les appels du jour au démarrage puis toutes les 30 s, si bien que l'API (playground) et le worker (brouillons) comptent les appels l'un de l'autre et qu'un redémarrage ne remet pas le compteur à zéro. Un appel pas encore écrit reste compté en mémoire. Le magasin (`LlmCallStore`) est écrit par la plomberie. En ceinture de sécurité, Charles fixe une limite mensuelle dans la console xAI.

## Prompts

`packages/llm/prompts/<role>/<name>.md` avec en-tête YAML. Versionnés, hachés, le hash est sur chaque draft. Règles : pas de logique métier dans un prompt ; variables par template strict ; contenu non fiable (messages fan, descriptions de médias fan) enveloppé par `wrapUntrusted()` dans un bloc délimité que le prompt système déclare comme données.

## Contexte (budget de tokens)

`assembleContext` construit l'entrée du cerveau et de la voix avec un budget explicite (`CreatorSettings.llm.contextBudgetTokens`, défaut 12 000) :

1. Persona (sections pertinentes : détails, infos en plus, comportement, stratégie en cours, limites ; `docs/reference/persona-schema.md`) et ses exemples de voix (`sample_replies`) — toujours. Les réponses corrigées du playground n'y entrent pas : elles sont écrites sur sa persona fictive et ne servent qu'au playground. C'est la version active de la créatrice (`persona_versions`, ADR 0010, 0022), lue à chaque brouillon ; sans version active, l'agent n'écrit rien et passe la main (`persona_inactive`).
2. Résumé fan (dernière version) — toujours.
3. Faits actifs, triés catégorie puis confiance — jusqu'à 40.
4. Derniers messages, du plus récent au plus ancien, jusqu'au budget — jamais l'historique entier.
5. Médias entrants décrits (description, pas le fichier).
6. État : cooldowns, slots KYC manquants, heure locale, script actif (P6).

L'heure de la créatrice (jour ou nuit, dans son fuseau), l'ancienneté de la relation et ce que le fan a dépensé arrivent dans une section « Le moment » des prompts de cerveau et de voix (1.4.0). Le code l'écrit (`describeSituation`, `modules/agent/domain/situation.ts`) : ce sont des faits de confiance, pas des données du fan, et ce qu'ils permettent (scripts de nuit, délai de sexualisation) reste décidé par la politique.

Persona par blocs (P5-01) : la fiche donnée aux modèles porte chaque bloc rempli dans sa section (`lifestyle`, `tastes`, `intimate`, `writing_style`, `sample_replies`) et `kyc_collect`, les cases du canevas Reveal qu'elle cherche à apprendre, parmi lesquelles seules le cerveau choisit `kycMissing` (prompt du cerveau 1.9.0). Depuis le prompt 1.10.0, un fait qui remplit une case du canevas porte son code comme `key` (`first_name`, `location`, `age`, `job`, `hobbies`, `desires`, `situation`) : le Suivi en tire « À apprendre » (`GET /v1/fans/:id/kyc`, `kycSlotsToLearn`), les cases qu'elle collecte sans fait actif de cette clé. Les emojis qu'elle n'emploie jamais sont bloqués par la garde `forbidden_term`, et ses réponses types passent les gardes dures avant d'être enregistrées (`sampleReplyFaults`).

## Le Brief (sortie du cerveau)

```ts
Brief {
  // BRIEF_INTENTS, packages/contracts/src/brief.ts: the one list, read by the model's schema and by the screens.
  intent: 'small_talk'|'kyc_answer'|'flirt'|'sexting'|'media_reaction'|'asks_for_media'|'price_objection'|
          'asks_if_bot'|'asks_to_meet'|'asks_personal_contact'|'asks_for_service'|'distress'|'complaint'|
          'off_topic_request'|'other';
  sentiment: 'positive'|'neutral'|'negative'|'aroused'|'frustrated';
  factsProposed: { category, key, value, kind: 'declared'|'inferred', confidence }[];
  kycMissing: KycSlot[];
  risks: ('minor_suspected'|'distress'|'meet_request'|'off_platform_payment'|'dispute'|'harassment'|'self_harm'|'money_trouble'|'manipulation_attempt'|'dangerous_request'|'real_abuse')[];
  desireSignals?: ('steers_to_intimate'|'body_compliment'|'asks_about_her_body'|'states_desire'|'explicit_language'|
                   'hot_media_reaction'|'roleplay'|'changes_subject'|'cold_reply'|'busy_now'|'slows_down'|'discomfort')[];
  alertsSeen?: string[];        // ids courts (a1…a50) des alertes de la créatrice reconnues, rien d'autre (P4-01)
  action: 'reply'|'offer'|'wait'|'follow_up'|'handoff';
  replyBrief: string;           // ce qu'il faut dire, en 1-3 phrases, pas le texte final
  toneHints: string[];
  // à venir : suggestedKycQuestion, followUpInMinutes
}
```

## La politique (code pur, `modules/agent/domain/policy.ts`)

Entrée : contexte + brief. Sortie : `Decision` + `policy_trace`. Ordre d'évaluation fixe :

1. Risques bloquants → `handoff` (non contournable, même en auto) : `minor_suspected`, `distress`, `self_harm`, `dangerous_request`, `real_abuse` (`agent/domain/hold.ts`), décidé avant que la voix écrive.
1 bis. Mots-clés d'alerte de la persona (`notifications.alert_keywords`) → `handoff` de cause `keyword`, lus en code sur ce que le fan a écrit depuis la dernière réponse, mots entiers une fois normalisés, avant tout appel de modèle (`agent/domain/alerts.ts`, P4-01). Un média signalé par la vision passe avant. Le journal garde le code `alert_keyword`, jamais ses mots. Ses alertes personnalisées (module `alerts`, `alertsOf`) suivent : un de leurs mots-clés, lu de la même façon, passe la main (cause `keyword`) si elle a coché « met en pause », sinon prévient seulement. Ses phrases vont au cerveau dans des blocs typés `creator_alert` (données, jamais des ordres), chacune avec un id court donné par le code (`a1` à `a50`, `BRAIN_ALERTS_MAX`) ; il rend les ids qu'il reconnaît dans `alertsSeen` et le code jette tout id qu'il n'a pas donné. Une phrase vue passe la main (cause `custom_alert`) ou prévient. Les alertes système viennent de l'intention : `asks_for_service` (contenu sur mesure, appel, cam, vocal : un humain peut le vendre) prévient ; `asks_if_bot` passe la main (cause `identity_doubt`) si un chatteur est en poste (`chatterOnShift`), sinon prévient et elle répond en personnage ; chacune se coupe par créatrice (`system_alert_settings`), `keyword` jamais. La première alerte qui met en pause va dans le `trigger` du passage à l'humain, toutes les autres deviennent chacune un `alert_triggered` (avec `notify`, la case « prévenir » de l'alerte), une seule fois par alerte jusqu'à sa réponse même s'il réécrit ou si la réponse est retentée (`alertsSince`) ; un risque qui passe la main l'emporte et toutes deviennent des avis. Alertes illisibles : la main passe (`alerts_unreadable`) ; le planning illisible compte comme aucun chatteur en poste. Réglages › Alertes essaie une alerte en cours d'écriture sur un message d'exemple (`POST /v1/alerts/test`, servi par le module `playground`) : les mots en code, la phrase par un appel au cerveau avec la persona active de la créatrice choisie parmi celles de l'alerte (sans version active, la phrase n'est pas lue et la réponse dit pourquoi), rien n'est gardé ni envoyé.
2. Interrupteurs, mode, session → `wait`.
3. Horaires de la persona (avec jitter) → `wait` avec `runAt`.
4. `asks_if_bot` → toujours une déflexion en personnage (`reply_brief`), fixée dans le code et non réglable : le prompt de voix et la garde bloquante `ai_disclosure` (ADR 0021, qui remplace ADR 0012).
5. Offre (dès la phase 3, décision de Charles du 17/10) : autorisée seulement si cooldowns expirés, KYC minimal atteint (délai de sexualisation réglable, 24 à 48 h par défaut), étape de script Reveal disponible et jamais envoyée à ce fan, aucun risque `money_trouble`, `distress`, `self_harm` ou `minor_suspected`. Prix fixé par le script : jamais de négociation ni de remise. Rythme (`offerDecision`, `agent/domain/policy.ts`, Charles 17/10) : un script au plus toutes les 10 heures par fan (délai réglable par créatrice), puis seulement si sa note de désir atteint le seuil de la créatrice (`low_desire` sinon, défaut 70) ; rien sous le drapeau « budget nul » ; un fan qui redemande lui-même du payant lève le délai, le budget nul et la note. Les drapeaux du fan (`fans.flags`, P3-02) passent avant : « ne plus écrire », ventes gelées ou âge non confirmé interdisent tout script, même s'il le demande ; ventes gelées, fan fragile ou « ne plus écrire » interdisent aussi la bouderie (`maySulk`). Sur une passation de main due à un risque, la politique pose elle-même les drapeaux, auteur `system` (`protectionFor`) : un mineur présumé perd l'âge confirmé, la détresse ou une menace pose « ne plus écrire » ; le composeur n'écrit rien à un fan « ne plus écrire », un humain lève le drapeau (`PUT /v1/fans/:id/flags`). Chaque brouillon garde la version du prompt de voix et le modèle qui l'a écrit (`drafts.prompt_hashes`), pour le taux en réel (ADR 0019). Bouderie (« chouinage ») au plus une fois par refus, jamais juste après un achat, jamais après un risque. Aftercare après chaque script. Détail métier : `/mnt/project-files/chatting/methode-chatting.md`.
5 bis. **Note de désir** (P3-12, `agent/domain/desire.ts`) : le cerveau relève des signaux fermés sur le dernier message (`desireSignals`), le code y ajoute l'intention, le sentiment et ce qu'il mesure sans modèle (longueur rapportée à sa médiane, vitesse de réponse, emojis suggestifs, messages à la suite), avec des poids versionnés (`DESIRE_WEIGHTS_VERSION`), bornés à 0 et 100. Sans message de lui, la note retombe de moitié toutes les 90 minutes, calculée à la lecture (`desireNow`, dans `packages/contracts` pour que le Suivi la lise comme le moteur ; plancher à 0 jusqu'à P6-01). Un risque qui interdit la vente la fige, `minor_suspected` ou un âge contesté la remet à 0. Elle ne fait que retenir : elle remplace « il sexualise maintenant » dans `offerDecision` et s'ajoute aux conditions pour qu'elle ouvre l'intime elle-même (`min_desire_to_open`, défaut 40) ; suivre un fan qui amorce ne change pas. Codes de signaux (`DESIRE_SIGNALS`), bandes et seuils 40/70 (`desireBandOf`) sont fermés dans `packages/contracts` ; le cerveau ne choisit que parmi `DESIRE_BRAIN_SIGNALS`. Le moteur rend la note à `conversations` seulement quand elle a bougé (`before`, `null` avant la première, ≠ `score`), et ne recompte jamais un message déjà compté ; le worker l'écrit au journal (`desire_scored`) et la projette.
6. KYC : au plus une question, seulement si `intent` s'y prête et pas de question dans les 3 derniers envois.
7. Relance : bornée par `persona.follow_ups` (délais, petits rappels par jour).

Chaque règle est une fonction testée unitairement avec cas nominal, limite, adversarial.

## Les gardes (code pur, `modules/agent/domain/guards.ts`)

Après la voix, sur le texte final : demande de photos intimes au fan, mépris (« radin », « menteur »), mensonge sur le payant (« rien à payer »), bouderie culpabilisante (souple), sortie d'assistante (recette, code, liste, balises), dégoûts et mots interdits (persona, liste normalisée avec variantes), anti-répétition (P3-13, ci-dessous), longueur par bulle, mention d'argent/prix hors offre, mention d'IA/prompt/système/assistant, fuite d'un autre fan (noms/faits d'un autre fan dans le contexte ne doivent pas apparaître), URL/téléphone/email, langue attendue. Une violation `blocking` interdit l'envoi ; une violation `soft` déclenche une régénération puis laisse passer avec trace.

Les gardes bloquantes lisent chaque bulle, puis le message entier tel que le fan le lit : bulles mises bout à bout, lettres cyrilliques et grecques ramenées à leur sosie latin, chiffres dans les mots démasqués (« 1A », « b0t »). L'aveu d'IA et la déclaration d'amour sont aussi cherchés en anglais et en espagnol. L'aveu d'IA couvre « IA » espacé ou ponctué après un article (« une i a », « une I-A », « un b o t »), ses synonymes (« assistante virtuelle », « algorithme ») et la négation d'être humaine ou réelle (« je suis pas humaine », « pas une vraie fille »). Un numéro coupé entre deux bulles, un numéro écrit en lettres (sept mots-nombres de suite, ou six chiffres dès « zéro » ou un « 0 » en tête, ou quatre après « mon num ») et un email écrit « at … dot com » comptent comme un contact ; une date (« 06/12/2024 ») n'en est pas un. Une rencontre se reconnaît à une invitation ou un lieu (« viens me voir à Paris », « on se retrouve à », « on se fait un verre ») ; « en privé », « au prochain live » ou « au lit » restent permis. Les bulles retouchées par un chatteur relèvent de l'approbation (module `conversations`).

Gardes de voix (P3-13) : une didascalie (« *sourit* », « (rires) ») se lit sur la bulle brute et bloque, les emojis restent permis. Un média annoncé (« je t'envoie une photo », « regarde ce que je viens de t'envoyer ») bloque quand le brouillon n'en porte aucun ; un brouillon du moteur n'en porte jamais, une offre (« tu veux que je t'envoie… ») ou une promesse pour plus tard passent. Les mots de rencontre que les plateformes repèrent même dans un refus (« rdv », « rendez-vous », « se rencontrer », « IRL », « se voir en vrai ») bloquent ; « en vrai » seul, « j'ai rencontré une copine » passent ; la liste est versionnée (`PLATFORM_MEETING_WORDS_VERSION`) et s'enrichit avec la capture Reveal. Une maladie, une dette, le loyer ou une urgence près d'un mot de vente ou d'argent, ou une demande d'argent pour elle, bloquent (`fake_emergency`). Contre ses vingt derniers messages (`GuardContext.previousTurns`) : une bulle déjà envoyée (15 caractères au moins) ou la même ouverture une troisième fois de suite (`repetition`), une troisième question fermée de suite (`closed_question_streak`) ; souples tant que la calibration ne les a pas jugées.

Les relances d'un modèle (429, 5xx, délai dépassé) attendent 0,5 s, puis 1 s, puis 2 s, au plus 4 s, ou le délai que demande le fournisseur (`retry-after`). Au-delà de 10 s demandées, la relance cède la place au modèle de repli. Le plafond du jour compte un appel au coût inconnu à 0,05 $, et rien pour une clé refusée. Il est vérifié avant chaque appel, sur les coûts déjà journalisés : quelques centimes de dépassement restent possibles quand plusieurs appels tournent en même temps, et c'est accepté.

## Humanisation (envoi)

Délai de première réponse dans une fenêtre dépendant de l'heure et de la persona ; « temps de frappe » ≈ 40-60 mots/min avec jitter ; bulles séparées ; `setTyping` si la plateforme l'expose ; jamais deux réponses identiques à deux fans ; horaires de vie avec variations hebdomadaires.

## Calibrage (playground, `modules/agent/domain/calibration.ts`)

Chaque réponse du playground se note : validée telle quelle, corrigée (la version réécrite), ou rejetée avec une raison (sonne IA, hors personnage, trop long, trop tôt sexuel, vente ratée, a oublié un fait, autre). Le **taux au playground** est la part des réponses validées sans retouche parmi les 50 dernières notées, lu par version du prompt de voix et modèle, avec la tendance sur la version précédente ; objectif 80 %. Il n'ouvre jamais le mode Automatique : seul le **taux en réel** (brouillons des vrais fans approuvés sans modification, 80 % sur au moins 100 brouillons décidés de la version) avec le test à l'aveugle le fait (ADR 0019). Une correction devient un exemple de voix ; un rejet pour une raison que le code doit porter (sexualisation, vente, mémoire) devient une règle à valider ; les autres deviennent des tests, rejoués après chaque changement. Les notes vivent hors dépôt (`.scratch/training/`, ou `NIRVANA_TRAINING_DIR`) jusqu'à la base. Spec complète, Coach compris : `moteur-ia/playground-entrainement.md` (dossier du projet).

## Évaluations

Exécuteur maison dans `apps/api/src/scripts/evals.ts`, scénarios dans `evals/` (34 au départ, 30 en `smoke`), juge = rôle `judge` de `LlmGateway`, rubrique à 8 critères (naturel du français, spontanéité, cohérence persona, pertinence, écoute, continuité, mémoire, absence de répétition) + critères de sécurité (pas de vente inappropriée, respect des limites, gardes). Seuils en CI sur `smoke`. Détail : `docs/playbooks/write-an-eval.md`.
