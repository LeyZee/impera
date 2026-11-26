# INS-04 Commentaires Instagram : une réponse dans sa voix, entraînée au Playground, les commentaires hostiles masqués
Statut : in progress (lot a fait, lot c écrit hors évals et branchement ; lot e en cours : sa voix calibrée sur ses vraies réponses ; tout se fait contre `FakeInstagram` ; l'essai réel attend le compte professionnel, l'application Meta et le mot écrit de Charles)
Phase : Instagram (ADR 0122)
Dépend de : ADR 0122 acceptée ; INS-01 (faux, contrats, branchement) ; le contrat des notes accordé avec le fil Playground
Branche : task/ins-04-instagram-comments
Propriétaire : fil Instagram ; relecture Sécurité (webhook, droits, données de tiers, gardes) avant toute fusion du serveur, Bilan (base, contrats, connecteur), Agent (prompt, gardes, évals), Playground (onglet), Design (écrans)

## Objectif
Un commentaire laissé sous une publication de la créatrice reçoit une issue (réponse courte dans sa voix, rien, masquage ou relais à un humain), préparée pour un humain tant que l'entraînement n'est pas validé, puis envoyée seule.

## Contexte à lire
ADR 0122 en entier, ADR 0057 § 1 et § 6, ADR 0120 § 1, ADR 0102, ADR 0021, ADR 0016, ADR 0010, `docs/architecture/connectors.md`, `docs/playbooks/add-a-connector.md`, la documentation officielle de l'API Instagram au moment du lot.

## À faire
Lot a, contrats, domaine et faux (aucune route, aucune table) :
- [x] Contrats Zod : commentaire reçu (identifiant, auteur opaque, texte borné, média, parent), bloc d'entrée du prompt sans nom ni pseudo, `comment_outcome` et sa raison, raisons des notes.
- [x] Domaine pur : gardes d'une réponse (garde des légendes, `public_explicit`, `repeated_reply`, celles du chatting réutilisées par leur `index.ts`), réécriture une fois puis `skip`, bornes par auteur, par jour et par fil, relais forcé (âge, détresse, rendez-vous, tarif, langue), commentaire de son propre compte ignoré.
- [x] `FakeInstagram` gagne les commentaires : lire, répondre, masquer, réafficher, supprimer, refus de Meta simulé.
- [x] Liste fermée des droits demandés à Meta, et le test qui échoue si un droit de messagerie y entre.

Lot b, serveur (relu par Sécurité avant fusion) :
- [ ] Webhook : signature vérifiée sur le corps brut avant toute lecture, poignée de main par jeton, taille et débit bornés, réponse immédiate puis job rejouable, rien du corps dans les logs, événement d'un compte non branché jeté. La route entre dans authentication-sweep et origin-sweep comme une exception écrite et testée.
- [ ] Table des commentaires : FORCE RLS, `GRANT SELECT … TO impera_service`, auteur opaque, durée de garde réglée par l'agence et bornée par le code, job de purge, effacement demandé par Meta honoré. Le pseudo n'est pas gardé au-delà du commentaire : lu à l'affichage ou purgé avec lui.
- [ ] Troisième accord de la créatrice (gérer les commentaires) ; le retirer éteint tout, jobs en attente compris.
- [ ] Interrupteurs par créatrice, éteints par défaut, propriétaire seul après une connexion récente : masquage, autonomie ; arrêt pour toute l'agence ; deux refus de Meta de suite éteignent l'autonomie en ambre.
- [ ] Envoi : clé d'idempotence, une réponse au plus par commentaire, délai court et irrégulier, heures calmes, limite par jour entre le plancher et le plafond du code.
- [ ] Audit de chaque masquage et de chaque suppression : identifiant du commentaire et nom de la règle, jamais le texte. Supprimer : geste du propriétaire seul, aucune suppression automatique.
- [ ] Doute sur l'âge relevé par le code sans le modèle ; un auteur en doute ouvert ne reçoit plus rien nulle part tant qu'un humain n'a pas tranché.

Lot c, voix (avec le fil Agent) :
- [x] Prompt `voice/instagram-comment` et son schéma de sortie dans `packages/llm` ; il ne lit que les panneaux publics de la persona, et un test échoue si un panneau intime y entre.
- [x] Le commentaire et la légende entrent dans un bloc typé non fiable ; la légende est coupée et nettoyée par le code.
- [x] Usage propre `instagram_comment` dans `llm_calls` (migration du contrôle), compté dans la conso IA et arrêté par le plafond du jour.
- [ ] Branchement : `commentWriterPersona` (module `agent`) donne la fiche publique et les gardes ; seuls les codes bloquants passent à `chatGuardCodes` (avec le lot b).
- [ ] Évals sur des commentaires inventés : sa voix en plus court, sans séduction ; commentaire sexuel sans réponse ; injection dans un commentaire sans effet.

Lot d, entraînement et écrans (fils Playground et Design) :
- [ ] Onglet « Commentaires » d'Entraîner (fil Playground, colonne `surface` de ses notes) : rien n'est envoyé à Instagram.
- [ ] Banque d'exemples « commentaire », par créatrice et par version de persona ; compteur d'autonomie calculé depuis les notes (seule « validée » compte, une nouvelle persona redemande une série).
- [ ] CRM : réponses préparées à envoyer, corriger ou refuser ; commentaires masqués avec « Réafficher » ; relais à un humain.
- [ ] Captures Nuit/Jour, téléphone et PC, vues par Design puis par Charles avant fusion.

Lot e, sa voix calibrée sur ses vraies réponses (amendement du 26/11 de l'ADR 0122) :
- [x] Prompt `voice/instagram-comment` 1.1.0 : ses vraies réponses d'abord, suggéré jamais cru, deux emojis au plus, une question seulement quand le code la permet.
- [x] Choix par le code des cinq paires les plus proches (`nearExamples`, sans modèle), dans le bloc `her_replies` du message.
- [x] Questions : `mayAskQuestion` (une réponse sur trois, bornée de deux à dix), garde `unwanted_question`.
- [x] `pnpm comment-calibration` : passage à l'aveugle sur le PC, chiffres seuls en sortie.
- [ ] Banque en base et import de l'export par le propriétaire dans le CRM (attend la forme de l'export, fil Bilan ; table neuve, migration numérotée par Bilan).
- [x] Premier calibrage sur le PC (40 commentaires, 0,83 $) : emojis variés, plus d'exclamations, questions quand le code les permet (prompt).
- [x] Corrections de la créatrice sur la feuille à l'aveugle : jamais d'intimité en public (prompt 1.2.0), « je t'aime » reçoit des emojis seulement (`declaresLove`, garde `words_in_emoji_reply`).
- [ ] Second calibrage, mêmes 40 commentaires, comparaison avant/après.

## Critères d'acceptation
- Tout passe contre `FakeInstagram` ; aucun appel réel à Meta dans un test.
- Tests : webhook à signature fausse refusé avant lecture, commentaire rejoué sans doublon, accord retiré qui vide les jobs, réponse refusée par une garde réécrite une fois puis ignorée, auteur en doute d'âge muet partout, masquage éteint par défaut, suppression refusée à tout autre que le propriétaire.
- Route nouvelle : authentication-sweep, origin-sweep, test d'isolation ; table nouvelle : FORCE RLS et droits du rôle de service.
- Aucun commentaire réel, aucun pseudo, aucun nom de compte dans un test, une fixture, une éval ou une doc. Les seuils (30 et 10, limites) sont des réglages ; ceux des tests sont fictifs.

## Hors périmètre
Les messages privés (exclus), commenter ailleurs que sous ses publications, la suppression automatique, la première réponse réelle sur un vrai compte (mot écrit de Charles), la publication (PUB-02).

## Notes de session

- 19/11 : lot a. Emplacements accordés avec le fil Bilan : module neuf `instagram-comments` (règles et port, un drapeau par capacité), port à part de celui de la publication, `FakeInstagram` dans `connectors/infra/fake` qui lit le port par l'`index.ts` du module, auteur opaque (empreinte salée). Les cinq gardes du chatting qui valent en public sont nommées ici (`CHAT_GUARDS_ON_A_REPLY`) et leurs résultats sont remis par le branchement : il se fait au lot c avec le fil Agent, qui relit aussi la liste des mots de `public_explicit`. `INS-01` n'ayant pas encore son faux, `FakeInstagram` naît ici avec les seuls commentaires ; la lecture des médias s'y ajoutera.
- 19/11, relectures du lot a. Sécurité : la détresse passe avant le silence d'un auteur en doute d'âge ouvert (silence et relais) ; aucun `@` ni `#` où que ce soit, formes pleine largeur repliées. Agent : au lot c, appeler `checkVoiceOutput` (porte existante, contexte vide) et refuser sur toute violation bloquante, les cinq codes de l'ADR restant le minimum testé ; `public_explicit` garde sa liste ici, mots génériques seulement, lue avec `touchesTerm`. Pour le lot b (Sécurité et Bilan) : clé d'auteur = HMAC à clé secrète par compte ; mentions de tiers retirées du commentaire avant le bloc d'entrée ; seuils d'autonomie validés par Zod à la frontière ; `reply` validée avant le port ; droit inconnu refusé à la connexion ; le relais de détresse d'un auteur muet ne déclenche aucun appel au modèle.
- 19/11, lot c. Accordé avec Bilan : méthode `instagramComment` du gateway calquée sur `channelPost`, usage propre, aucune règle métier dans le prompt, sortie validée par `CommentOutcomeSchema` (invalide après le repli : relais `other`, jamais un texte réparé ; plafond atteint : aucun appel, aucune réponse). Accordé avec Agent : pas de porte neuve, `channel-persona.ts` généralisé (`publicWriterPersona`, une seule liste de ce qui reste privé pour Telegram et Instagram) et `commentWriterPersona` à la longueur d'une réponse. Les mentions de tiers sont retirées du commentaire et de la légende avant le bloc d'entrée. Les évals payantes attendent l'accord de Charles sur leur nombre et leur coût.
