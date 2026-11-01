# P3-11 Réponse différée après « attends, je reviens »

Statut : done (ID validé par Charles le 27/10 à 19h56)
Phase : 3
Dépend de : P3-10 (relances, worker et moteur)
Branche : task/P3-11-deferred-respond

## Objectif

Quand le fan écrit « attends, je reviens » ou « deux minutes », le cerveau choisit d'attendre (`action: 'wait'`). Le moteur rend alors `no_reply` (`hold.ts`), et `conversation.respond` écrit `reply_skipped`. Ensuite, plus rien ne se passe :

- aucune relance n'est programmée, puisque le worker ne programme qu'après un envoi d'elle (P3-10) ;
- « À traiter » ne montre pas la conversation, puisque le Dashboard ne la compte que dans `waiting`, sans l'ouvrir.

S'il ne revient jamais, son dernier message reste sans réponse. Cette fiche fait de l'attente une réponse différée et bornée, puis passe la main à un humain.

Ce n'est pas une relance : une relance (P3-10) suit **son** silence à lui, après une réponse d'elle. Ici, c'est elle qui n'a pas encore répondu à un message de lui.

## Contexte à lire

- `docs/architecture/message-flow.md` §1 (respond) et §4 (Relance)
- `apps/api/src/modules/conversations/application/jobs/respond.ts`, `application/follow-ups.ts` (programmer dans la transaction, `job_key`)
- `apps/api/src/modules/agent/domain/hold.ts` (`holdDecision`, cas `wait`)
- `apps/api/src/modules/supervision/infra/views/dashboard-reader.ts` (« À traiter », `waiting`)
- `packages/contracts/src/events.ts` (`reply_skipped`)
- `PROPOSED-method-gaps.md` (ligne « Alerte à l'opérateur sur tout fan qui écrit sans réponse »)

## Règles

1. **Le moteur dit quand revenir.** Un `wait` rend `no_reply` avec `retryAt`, borné par le code entre 10 et 25 minutes côté moteur (point de départ : 20 minutes, à calibrer) ; le worker n'accepte que 5 à 25 minutes, pour que le filet de 30 minutes vienne toujours après. Le cerveau ne fixe pas ce délai (CLAUDE.md, règle 3).
2. **Le worker reprogramme `conversation.respond`.** Il le fait sur la même file `conv:<id>`, avec la même clé `conversation.respond:<id>`, en mode `replace`, à `retryAt`. Un nouveau message du fan remplace naturellement ce job : il répond alors au nouveau message, sans rien à annuler.
3. **Une seule attente** pour le même dernier message du fan. Le second passage porte `waitedFor` (son message attendu) dans la charge du job : un nouveau message remplace le job et remet donc le compte à zéro. Si le second passage n'écrit toujours rien (refus, garde, modèle injoignable), c'est une passation (`handoff_requested`, cause `other`, raison `waited_no_reply`, sans nouvelle cause au contrat), donc « À traiter ».
4. **Le moteur sait qu'il a déjà attendu.** `ComposeInput.waited` (en ajout) porte le nombre d'attentes déjà faites pour ce message. Avec `waited ≥ 1`, le moteur n'a plus le droit de rechoisir `wait` : il écrit un petit message pour lui demander s'il est revenu, avec un brief fixé par le code comme pour les relances, et toutes les gardes. La passation de la règle 3 est le filet si ce message ne s'écrit pas.
5. **Revérification sous verrou** comme pour `respond` : la conversation doit être au repos, aucune prise en main, aucune pause, les portes ouvertes. Sinon, rien n'est écrit.
6. **« À traiter »** montre aussi, au-delà de 30 minutes, une conversation dont le dernier message du fan n'a ni réponse, ni brouillon, ni job prévu. C'est un filet de sécurité pour tout trou futur, pas seulement pour `wait`.

## À faire

- [x] Contrats (Bilan) : `reply_skipped` gagne `retryAt?` et `conversation.respond` gagne `waitedFor?`, en ajout. `ComposeResult` ne change pas : `retryAt` existe déjà depuis #204. Le port `ComposeInput` gagne `waited?: number` en ajout (conversations).
- [x] Agent : `holdDecision` (`wait`) → `retryAt` borné ; avec `waited ≥ 1`, jamais `wait`, mais un message « tu es revenu ? » écrit sur brief du code. Tests du domaine et du composeur.
- [x] Conversations (Bilan) : `respond` reprogramme sur `no_reply` avec `retryAt`, passe `waited` au moteur et passe la main si le second passage n'écrit rien. Tests d'intégration : attente puis réponse, nouveau message pendant l'attente, second passage sans brouillon et passation, prise en main pendant l'attente.
- [x] Supervision (Agent) et Dashboard (Extension) : l'entrée « sans réponse depuis 30 minutes » dans « À traiter » (`unanswered`, « Sans réponse »).
- [x] Doc : `message-flow.md` §2, glossaire (Réponse différée).

## Critères d'acceptation

- Un « attends, je reviens » donne, vers 20 minutes plus tard et s'il n'a rien écrit entre-temps, un message qui lui demande s'il est revenu, pas une seconde attente.
- Un nouveau message pendant l'attente reçoit une seule réponse, pas deux.
- Un second passage qui n'écrit rien fait une passation, donc une entrée dans « À traiter ».
- `pnpm check`, `pnpm test` et `pnpm test:integration` sont verts.

## Hors périmètre

Les relances sur son silence (P3-10), les relances de vente (`P6-02-after-offer.md`), tout envoi réel.

## Notes de session

27/10 : proposée par Bilan, après la seconde passe méthode / code du fil Agent (#209).

27/10 soir : part Bilan (contrat, worker `respond`, tests) dans sa PR ; bornes accordées avec le fil Agent (10–25 min côté moteur, 5–25 côté worker).

27/10 soir : part Agent (moteur : une attente de 20 minutes, puis « tu es revenu ? » sur brief du code ; filet `unanswered` en supervision, états `idle`, `pending` et `drafting`, muet sous arrêt d’urgence ou Reveal non lu) dans sa PR. Rien ne reste.
