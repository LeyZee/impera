# 0088. Fan en détresse : l'agent lui répond en mode soin, ventes gelées dans le code, et un humain valide chaque réponse

Statut : accepted (« ok 0088 » de Charles le 11/11/2026, 17 h 40, chat du projet ; phrases amendées après la relecture du fil Agent acceptées par « ok phrases 0088 » le 12/11/2026, 23 h 12 ; décision de Charles sur carte, 11/11/2026 17 h 36, fil « Recetter les écrans du chatteur » : « IA en mode soin, validée », après son message de 17 h 35 : un chatteur, motivé par la commission, risque de vendre derrière, l'IA est préférable ; numéro attribué par le coordinateur)
Date : 2026-11-11
Amende : le filet de sécurité de la recette AGT-01 (« ok filet sécurité » de Charles, 06/11/2026 18 h 41, `agent/domain/safety-net.ts`) pour l'idée noire seulement ; la règle « détresse → humain, sans réponse automatique » de la méthode de chatting ; `protectionFor` (P3-02, `agent/domain/hold.ts`), qui pose « Ne plus lui écrire » sur la détresse. Précise : 0021 (rester en personnage, fixé dans le code), 0019 (taux en réel et passage en Automatique), 0085 § 9 (fan fragile proposé, jamais posé seul), 0020 (alerte Telegram urgente). Ne touche pas au mineur possible, ni au harcèlement, à la demande dangereuse ou à l'arme. Changement de nature assumé : aujourd'hui le filet passe la main « avant qu'aucun modèle ne lise le message » ; en mode soin, le cerveau et la voix le lisent, pour lui répondre.

## Contexte

Aujourd'hui, quand un fan montre une détresse ou parle de se faire du mal, le code fait deux choses qui se contredisent à l'écran (recette du 11/11, anomalie 1) :

- la conversation passe à un humain, et « À traiter » dit « un humain doit lui répondre » ;
- la politique pose « Ne plus lui écrire » sur le fan, et sa fiche dit en rouge « Personne ne lui écrit, ni l'agent ni toi dans Reveal ».

Le chatteur ne sait pas quoi faire. Et Charles ne veut pas que ce soit un chatteur seul : payé à la commission, il a intérêt à revenir à la vente. Il veut que ce soit l'IA qui écrive, avec la vente coupée, et un humain qui relit.

## Décision

1. **Ce qui ouvre le mode soin.** Les risques `distress` (y compris le récit d'un abus qu'il a subi) et `self_harm`, lus par le cerveau ou par le filet en code. Rien d'autre : un mineur possible garde sa passation (aucune réponse de l'agent), et le harcèlement, la demande dangereuse, l'arme et `real_abuse` (un abus qu'il a commis) gardent « Ne plus lui écrire ».

2. **Ce que le code pose sur le fan.** Plus de « Ne plus lui écrire » pour ces trois risques. À la place :
   - **ventes gelées** (`salesFrozen`, raison `distress`) : aucune offre, aucun script, aucun média payant, aucun chouinage, aucune relance commerciale. La politique le vérifie avant tout appel au modèle, comme aujourd'hui ;
   - **rien d'explicite** (`noExplicit`) tant que dure le mode soin ;
   - la proposition « Le marquer fragile ? » de l'ADR 0085 § 9 (ligne ambre), jamais posée seule.

3. **Ce que l'agent écrit.** Une réponse d'écoute, dans la voix de la créatrice (ADR 0021 : elle reste elle-même et ne dit jamais être une IA) : courte, chaleureuse, sans séduction ni sous-entendu, sans promesse, sans conseil médical. Elle l'invite à en parler à quelqu'un de proche. Les consignes sont un prompt versionné (« voix · soin ») ; les interdits restent dans le code : prix, lien, média, script, rendez-vous et vocabulaire sexuel sont refusés par une garde `care` qui arrête le brouillon. Sa liste de mots sexuels est courte et testée, pour ne pas arrêter « je t'embrasse » ou « câlin ».

4. **Idées noires : un numéro d'aide, posé par le code.** Sur `self_harm`, la première réponse se termine par une bulle fixe, écrite dans le code et non par le modèle, une seule fois par épisode. Le code ne connaît pas le pays du fan : la bulle suit sa langue. En français, elle donne le 3114 (numéro national de prévention du suicide, France) ; sinon, une phrase fixe l'invite à parler à quelqu'un de proche ou à appeler les urgences de son pays.

5. **Toujours validé par un humain.** En mode soin, chaque réponse de l'agent est un brouillon qui attend un humain, même si la créatrice est en Automatique (ADR 0019). Valident : le chatteur en poste sur la créatrice, un manager ou le propriétaire. **Valider** et **Retoucher** passent par la garde `care` : une retouche qui ajoute un prix, un lien, un média ou un mot sexuel est refusée avec la raison. **Refuser** ne laisse pas le chatteur seul : l'agent propose une autre réponse, trois fois au plus par message du fan ; ensuite, la ligne rouge dit « Réponds-lui toi-même ». Un nouveau message du fan remplace le brouillon en attente, il ne s'empile pas. La réponse soin se valide dans le lecteur du Suivi ; le panneau copilote la montre aussi, même quand ses brouillons sont éteints (ADR 0086). Jamais d'envoi sans validation : si personne ne valide, rien ne part, même après une heure ; la ligne rouge reste et l'alerte Telegram urgente est renvoyée une fois au bout d'une heure. Tant que le connecteur de messagerie Reveal n'envoie pas (P2-02 à P2-06), « Valider » ne peut rien envoyer : l'humain copie la réponse validée dans Reveal (décision de Charles du 11/11 : « Copier le texte »), et la garde `care` ne protège que ce qui passe par le CRM.

5 bis. **Quand l'IA ne répond pas.** Si le modèle refuse, répond par son propre texte de sécurité (arrêté par `ai_disclosure`), tombe en panne, ou si le budget du jour est atteint, aucune réponse n'est proposée : la ligne rouge devient « L'IA n'a pas pu lui répondre : réponds-lui toi-même », jamais le silence. Même repli quand `distress` ne peut pas être lu faute de modèle : le filet en code ne voit que les idées noires et le mineur, le reste dépend du cerveau.

6. **Ce que voit l'équipe.**
   - « À traiter » : ligne rouge « Détresse : l'agent lui répond avec douceur, valide sa réponse », qui reste rouge tant qu'une réponse attend.
   - Conversation : bandeau « Mode soin » et la phrase qui l'a ouvert ; Retoucher et Refuser comme d'habitude.
   - Fiche : « Ventes gelées · détresse » et « Rien d'explicite » en rouge ; plus jamais « Ne plus lui écrire » pour ces risques.
   - L'alerte Telegram urgente de l'ADR 0020 est gardée, sans le texte du fan.
   - L'Historique des alertes garde la trace de l'épisode (décision de Charles du 11/11 : il montre tout ce qui a arrêté l'agent).

7. **Sortie du mode soin.** Seuls un manager ou le propriétaire peuvent la décider (« Il va mieux »), jamais un chatteur. Les ventes et « Rien d'explicite » restent posés encore 30 jours après la sortie, puis un manager ou le propriétaire les lève. Un nouveau signe pendant ce délai rouvre le mode soin.

8. **Ce qui ne change pas.** Le mineur possible (passation, âge contesté, confirmation pour rendre la main). Les gardes `ai_disclosure`, rencontre et paiement hors plateforme. Le budget IA. Une créatrice ne voit rien de l'épisode (ADR 0063).

## Conséquences

- Le fan en détresse reçoit une réponse rapide, humaine dans le ton, sans vente possible : c'est le code qui la bloque, pas la bonne volonté du chatteur.
- Un humain lit chaque mot avant qu'il parte : le modèle ne parle jamais seul à quelqu'un qui parle d'en finir.
- Code (relecture du fil Agent, 11/11) : `holdDecision` gagne un cas `care` à part de `handoff` ; `protectionFor` sort `distress` et `self_harm` de `STOP_SIGNS` vers une liste `CARE_SIGNS` (ventes gelées, raison `distress`, et `noExplicit`), reprise par `protectionWhileAnswering`.
- Coût : un prompt « voix · soin » versionné, une garde `care`, un état de conversation (mode soin) et une migration pour l'enregistrer (numéro à demander), des textes d'écran, et des évals sur des messages inventés (`evals/`), jamais de vrai message de fan.
- Risque connu : le chatteur peut toujours écrire lui-même dans Reveal. Le CRM ne peut pas l'empêcher, mais les ventes gelées coupent toute vente proposée par l'agent, et l'équipe voit le bandeau rouge.

## Questions tranchées

Par Charles le 11/11/2026 à 17 h 39 (« Je suis d'accord avec toutes tes recos. Applique tes recos. ») :

1. Le récit d'un abus réel qu'il a subi entre en mode soin (précisé le 12/11 : victime seulement, pas l'auteur).
2. Après la sortie, les ventes restent gelées 30 jours.
3. Sur les idées noires, la bulle fixe du 3114 part une fois par épisode.
4. Sans validation, rien ne part, même après une heure.

## Mise en œuvre

- Lot 1 (serveur, 12/11) : `agent/domain/hold.ts` (`CARE_RISKS`, `holdDecision` → `care`, `Protection.care`), `agent/domain/care.ts` (consignes de la voix en soin, garde `care_breach`, bulle d'aide), le composeur (`settleCare`), les événements `care_opened` et `care_closed`, la migration 0188 (`conversations.care_since`, `care_help_at`, `care_closed_at`) et `POST /v1/conversations/:id/care/close` (propriétaire ou manager). Les consignes de la voix en soin sont une consigne écrite par le code, comme les autres consignes fixées par le code (`compose.ts`), versionnée avec lui.
- Hors de ses créneaux de réponse (relecture Agent, 12/11) : le soin n'est pas reporté quand le code le sait déjà, un épisode ouvert ou des idées noires écrites en clair depuis sa dernière réponse. Rien ne part sans un humain, reporter ne ferait que retarder le moment où quelqu'un le voit. Un premier signe que seul le cerveau lit attend son ouverture.
- Tranché par Charles le 12/11 (« victime seulement ») : le mode soin couvre le fan qui raconte un abus qu'il a subi, lu comme `distress` ; `real_abuse` ne nomme plus que l'abus qu'il a commis (corpus L28) et garde la passation et « Ne plus lui écrire ». Le prompt du cerveau le dit ainsi.
- Lots suivants : les écrans (bandeau, ligne rouge d'« À traiter », fiche, « Il va mieux »), la réponse proposée de nouveau après un refus (trois fois au plus), le rappel Telegram au bout d'une heure, la levée des ventes gelées 30 jours après la sortie.
