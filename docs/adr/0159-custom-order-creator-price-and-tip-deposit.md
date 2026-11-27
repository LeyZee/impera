# 0159. Une demande sur mesure passe par l'accord et le prix de la créatrice ; l'IA prend la commande avec un acompte par pourboire et livre depuis un dossier rattaché au fan

Statut : accepted (Charles, 20/11/2026, 15 h 36, « ok sur-mesure » ; demande de Charles du même jour, 15 h 32)
Date : 2026-11-20
Remplace : l'ADR 0090 § A, points 1 et 2 (« l'IA ne vend jamais de sur-mesure ») ; garde le reste de l'ADR 0090 (réponse d'attente, garde `no_commitment`, objections de prix).
Précise : l'ADR 0145 (rôles des dossiers du coffre), l'ADR 0150 (alerte « Offre proposée »), l'ADR 0135 (time waster), l'ADR 0018 (garde d'écriture), l'ADR 0021 (elle reste elle-même), l'ADR 0088 (règle d'âge).

## Contexte

Le 11/11, Charles avait décidé qu'une demande sur mesure passe toujours à un humain. Le 20/11, il décrit un circuit où l'IA la vend elle-même, à condition que la créatrice ait dit oui et donné son prix : la créatrice reçoit la demande du fan, accepte ou non, fixe son prix ; le fan paie la moitié d'avance par pourboire pour passer commande (beaucoup de fans annulent après deux jours, quand la vidéo est parfois déjà tournée) ; la créatrice dépose la vidéo dans un dossier réservé ; l'IA l'envoie avec le reste du prix. Une vidéo sur mesure est liée à un fan (son prénom, une demande à lui) et n'est jamais réutilisée.

Il demande aussi : une grille interne de prix que l'IA lit (cam à la minute…), des photos offertes de temps en temps aux meilleurs clients, et le relais à la créatrice d'une demande de preuve non sexuelle quand un fan doute que ce soit elle.

## Décision

### Règle première : tout paiement passe par Reveal

Charles (20/11, 15 h 48) : jamais un paiement hors de Reveal, même quand l'appel ou la visio se passe ailleurs. L'acompte, le solde, un appel, une visio, une rallonge : tout est payé dans Reveal (pourboire ou média payant), pour être compté. L'IA n'accepte, ne propose ni n'évoque aucun autre moyen de paiement (virement, carte, PayPal, crypto, carte cadeau, paiement sur Instagram…). Un fan qui en propose un reçoit un refus dans son personnage, et la commande ne passe à `deposit_paid` que sur un paiement vu dans Reveal. La garde « paiement hors plateforme » reste bloquante sur toute réponse de cette ADR.

### 0. Ce qui se commande

Précision de Charles (20/11, 15 h 44) : le plus souvent une vidéo tournée pour lui, parfois des demandes très précises ou crues ; une photo (son prénom écrit sur elle…) ; sa réaction filmée à une photo intime qu'il envoie, ou une note donnée à cette photo ; un appel ; une visio, juste pour parler ou sexuelle.

- **Une liste fermée de types**, lue par le cerveau : `custom_video`, `custom_photo`, `reaction_video`, `rating`, `call`, `video_call_talk`, `video_call_sexual`.
- **Un niveau**, lu par le cerveau dans une liste fermée : `soft`, `explicit`, `exclusive` (une demande plus crue ou plus exclusive coûte plus cher à tourner). Le cerveau ne lit que le type et le niveau, jamais un prix.
- **Ce qu'elle ne fait jamais** (`never_do` de sa fiche) est décliné par le code avant toute demande à la créatrice (règle actuelle de `customOrderDecision`).
- **Une photo intime envoyée par le fan** pour une réaction ou une note passe par les règles actuelles : doute d'âge ouvert, rien ne s'ouvre.

### A. La commande sur mesure

1. **Les états, dans le code** (module `custom-orders`, `CUSTOM_ORDER_STATES` des contrats) : `gathering` (les détails se rassemblent, le « `asked` » du premier texte) → `awaiting_creator` (la fiche est partie) → `creator_yes` (avec prix) ou `creator_no` → `deposit_paid` → `delivered`, et `expired` / `cancelled`. Un appel ou une visio suit le § D (paiement entier d'avance). Chaque passage est un événement de conversation, idempotent.
2. **`asked` : comprendre la demande en entier avant de la transmettre** (Charles, 20/11, 15 h 52 : « il faut que la modèle sache exactement quoi faire, la durée, la prestation et le prix »). L'IA ne dit ni oui ni non et ne donne aucun prix ; elle répond sous la garde `no_commitment`. Elle recueille les détails par deux ou trois questions joueuses dans la conversation, une à la fois, jamais en questionnaire. Le code tient la liste des informations obligatoires selon le format, le cerveau remplit les cases, le code dit ce qui manque :
   - toujours : ce qu'il veut voir, décrit précisément ; pour quand il le voudrait ; le prénom ou le mot à dire ou à écrire, s'il y en a un ;
   - photo : la pose, la tenue, le texte écrit, le nombre de photos ;
   - vidéo : la durée, le déroulé, la tenue, ce qu'elle dit ;
   - réaction filmée ou note : la photo qu'il envoie (déjà reçue), le ton voulu ;
   - appel ou visio : la durée, parlée ou sexuelle, les moments où il est libre.
   Une demande hors de ses limites (« Elle le fait ? » sur non, `never_do`) est déclinée sans rien demander de plus : c'est la réponse que la créatrice a donnée d'avance.
2 bis. **La fiche envoyée à la créatrice, seulement quand elle est complète** : avec quel fan (son prénom connu et le lien vers la conversation, dans le CRM et son espace, jamais dans le texte d'une notification), ce qu'il veut en détail, la durée, pour quand, le format et les suppléments lus, et le prix calculé par la grille, à accepter ou changer. Sans les informations après trois questions, la fiche part au propriétaire, qui décide. Pendant l'attente, l'IA garde le fan chaud et continue la conversation, sans rien promettre (Charles, 20/11, 15 h 53, « tu peux appliquer tout ça »). Tant que l'espace de la créatrice n'est pas en ligne, la fiche part au propriétaire, qui saisit sa réponse.
3. **`creator_yes`.** Rien n'est annoncé au fan avant ce oui, même quand la grille donne un prix. Seul un humain (la créatrice, ou le propriétaire pour elle) saisit le oui et le prix. Le modèle ne fixe jamais un prix. L'IA annonce le prix exact et demande un pourboire pour prendre la commande : la moitié pour une vidéo, la totalité pour une cam, un appel ou une visio (§ D), rien d'avance pour le reste, payé à la livraison (amendé le 27/11, Charles : « une cam, c'est vraiment la totalité », une vidéo personnalisée « à moitié », pour être sûr qu'il la veut, puisqu'elle ne se revend pas ; le code le calcule, `customDepositMinor`). La garde `no_commitment` est levée pour ce prix-là seulement, et la garde `price_outside_offer` laisse passer ce seul montant (`GuardContext.allowedPriceMinor`) ; « jamais de négociation » s'applique.
4. **Le pourboire n'est demandé qu'ici.** Une garde de voix bloque toute demande de pourboire hors d'une commande à l'état `creator_yes`. Un remerciement pour un pourboire spontané reste permis.
5. **`deposit_paid`.** Le code reconnaît un pourboire de ce fan, d'au moins l'acompte demandé (la moitié d'une vidéo, la totalité d'une cam, d'un appel ou d'une visio ; amendé le 27/11), arrivé après l'annonce. Un montant plus bas ou ambigu passe à un humain.
6. **`delivered`.** La créatrice dépose la vidéo dans un dossier de rôle `custom` (§ B). L'IA l'envoie comme média payant au prix restant, derrière la garde d'écriture.
7. **`creator_no`.** L'IA décline avec douceur, sans reproche, et reprend la conversation.
8. **Délais** (défauts dans le code) : sans réponse de la créatrice en 24 h, la demande revient au propriétaire ; livraison attendue 72 h après l'acompte, rappel à la créatrice à 48 h, alerte au propriétaire au-delà. L'IA ne donne jamais de délai au fan.
9. **Annulation.** L'acompte est gardé si le fan annule après le oui. Si la créatrice ne livre pas, un humain décide. L'IA ne promet jamais de remboursement.
10. **Quand le proposer.** L'IA n'ouvre pas d'elle-même une commande, sauf à un fan qui a acheté toutes les étapes d'un script le même soir et en redemande : elle peut alors évoquer une vidéo pour lui ou une cam, au lieu d'un deuxième script (jamais deux scripts le même soir).
11. **Ce qui prime.** Doute d'âge ouvert, fan fragile, ventes gelées, « Ne plus lui écrire », risque de `NO_SALE_RISKS`, `never_do` : aucune commande, aucun pourboire demandé (règle actuelle de `customOrderDecision`, inchangée). Un chatteur en poste peut toujours prendre la conversation.

### B. Le dossier « Perso » du coffre

12. Nouveau rôle de dossier `custom` (ADR 0145). Chaque média y est rattaché à un fan. Garde dans le domaine : un média `custom` ne part qu'au fan auquel il est rattaché, n'entre jamais dans un script, un Mass DM, le feed ni une story.
13. L'écriture dans le coffre suit l'ADR 0145 § 3 et la garde d'écriture. Rien n'est déplacé ni supprimé dans Reveal.

### C. La grille interne

14. Rangée dans sa propre table, une version par enregistrement (`custom_price_grids`), pour être modifiable à tout moment sans activer une nouvelle persona : propriétaire seul en lecture et écriture, fermée au manager, au chatteur et à la créatrice, jamais dans le dépôt, jamais entière dans un prompt (seul le prix calculé en sort). Chaque enregistrement garde sa date ; une demande déjà acceptée garde son prix. Elle se règle dans la vue « Sur mesure » de l'onglet Scripts de sa fiche.
15. Elle donne un prix par type et par niveau (§ 0) : un prix fixe pour une vidéo, une photo, une réaction ou une note ; un prix à la minute et une durée minimale pour un appel ou une visio. Le propriétaire la saisit lui-même.
15 bis. **Le code calcule le prix proposé** à partir du type, du niveau et, pour un appel ou une visio, de la durée demandée. Ce prix est présenté à la créatrice avec la demande ; elle l'accepte ou le change (§ A.3). L'IA n'annonce au fan que le prix accepté par la créatrice.

### D. Appels et visios

16. **Payés en entier d'avance, et toujours dans Reveal**, même si l'appel ou la visio se passe ailleurs (règle première), par pourboire : la durée achetée fois le prix à la minute. Pas d'acompte de moitié ici : le paiement vient d'abord (Charles, 20/11).
17. **L'appel ou la visio se passe sur Instagram, et c'est la créatrice qui le passe elle-même.** Aucune automatisation Instagram (ADR 0057). L'IA vend et prévient, rien de plus : elle n'écrit jamais un nom de compte, un lien ni une heure (les gardes « coordonnées » et « paiement hors plateforme » restent actives sur sa voix). Une fois le paiement reçu, la commande passe à un humain (créatrice ou propriétaire), qui donne le moyen de contact et cale l'heure.
18. Le temps non utilisé n'est pas rendu par l'IA ; un dépassement se paie avant, jamais après. Un litige va à un humain.

### E. Les cadeaux aux meilleurs clients

19. Nouveau rôle de dossier `gift`, rempli d'avance par la créatrice. Le code seul décide de l'envoi : fan au-dessus du seuil de dépense saisi par le propriétaire (secret, en base) ; au plus un cadeau tous les 14 jours ; jamais le même deux fois au même fan ; jamais juste après un refus ; aucune offre payante dans les 24 h qui suivent.
20. Un cadeau envoyé porte la marque « offert » (ADR 0145 § 2) : il n'entre plus jamais dans une étape payante.

### F. Le relais de preuve

21. Quand le cerveau lit une demande de preuve non sexuelle d'un fan qui doute (`identity_doubt` avec demande de preuve), l'IA reste elle-même et ne promet rien (garde « média annoncé mais pas envoyé »). La demande part à la créatrice et au propriétaire. Au plus un relais par fan tous les 7 jours ; au-delà, un humain décide.
22. La preuve revient par un humain, ou par le dossier `custom` rattaché au fan.

## Mise en œuvre

Le code vient en petits lots. Charles a levé l'attente de la première vente réelle le 20/11 à 15 h 29 (« code tout ce que je t'ai dit ») ; le partage avec le fil Agent : le module `custom-orders` porte la décision en code pur (états, détails par format, questions, fiche, prix de la grille, briefs, gardes), l'agent la branche dans son tour et fait lire au cerveau le format et les détails.

0. Comprendre la demande en jouant (§ A.2, A.2 bis) : lecture du format, des suppléments et des détails (`CustomOrderReading`), une question légère à la fois, au plus trois, fiche complète à la créatrice ou incomplète au propriétaire, fan gardé au chaud (`customOrderTurn`).

   Commande enregistrée (lot du 20/11 au soir) : table `custom_orders` (migration 0242), une commande ouverte par fan au plus (`gathering` ou `awaiting_creator`), écrite par le tour de l'agent sous la RLS de la créatrice (`withTenant`), jamais par le rôle de service ; le même message du fan ne compte qu'une fois ; le fan est lié à la créatrice de la commande par une clé étrangère composée. Le compte de la créatrice n'en lit rien avant le lot 1.

1. Oui ou non et prix de la créatrice saisis sur la ligne « Demande sur mesure » d'« À traiter » ; annonce du prix et demande d'acompte ; pourboire reconnu ; garde « pourboire seulement ici » ; relais de preuve (§ F).

   Réponse de la créatrice, côté serveur (lot du 21/11) : migration 0267 (`price_minor`, `deposit_minor`, `decided_by`, `decided_at`, prix au moins 1 €, acompte entre 0 et le prix). `GET /v1/creators/:creatorId/custom-orders` (en cours, ou toutes) est lu par le propriétaire et par un manager actif qui la suit, en lecture seule (Charles, 21/11) ; `POST …/:orderId/decision` (oui à un prix, ou non) et `POST …/:orderId/advance` (acompte reçu, livrée, annulée) par le propriétaire seul. L'acompte se calcule au oui (`customDepositMinor`) : moitié d'une vidéo, tout pour un appel ou une visio, rien pour le reste. Une étape qui ne part pas de l'état de la commande est refusée (409). Le journal d'audit garde qui a fait quelle étape, jamais un prix. Chatteurs et compte de la créatrice n'en lisent rien encore ; l'annonce du prix au fan reste au fil Agent.
2. Dossier `custom` rattaché au fan, livraison au prix restant (§ B, § A.6).
3. Grille interne (§ C).

   Vidéos déjà tournées (lot du 26/11, avec le fil Coffre) : la grille porte une liste `readyVideos`, des types de vidéos qu'elle vend hors des scripts, nommés par le propriétaire (le dépôt n'en nomme aucun), chacun avec une fourchette (au moins 1 €, haut au moins égal au bas) et un interrupteur « En vente ». Une grille enregistrée avant se lit sans aucun type : pas de migration. Le prix d'une vidéo est tiré dans la fourchette de son type et arrondi à l'euro par une fonction pure (`readyVideoPriceMinor`, même graine, même prix) ; le moment du tirage et l'endroit où il est figé appartiennent à la vente (fil Coffre).
4. Cadeaux (§ E).
5. Plus tard : vocaux préparés, réponse de la créatrice depuis son espace.

   Cam (Charles, 21/11 et 26/11 ; amende le § D.17 pour l'heure seulement) : Reveal n'a pas de live, la cam se passe sur Instagram et c'est toujours la créatrice qui la passe. Elle ouvre des « dispos cam » dans son Agenda (une plage, chaque semaine sur les jours qu'elle coche, « Tous les jours » en un geste, ou une fois) ; une dispo cam n'est jamais du temps pour l'agence, ses suggestions et sa semaine n'y tombent pas (migration 0278, `opens_to`). Le code, jamais le prompt, cherche le créneau (`camSlotOf`) : dans une dispo cam, pas avant un préavis de 15 min, sur aucune de ses tâches à heure ni sur une cam déjà réservée et 15 min de marge autour, jamais un jour de son absence, au quart d'heure, sur deux semaines ; « tout de suite » s'il commence dans l'heure, sinon un autre créneau ; aucun s'il n'y a pas de place, et alors aucune heure n'est promise. Le créneau est réservé quand le paiement complet est reçu (migration 0279, `cam_starts_at` et `cam_ends_at`) ; deux paiements pour elle au même moment s'attendent. L'heure n'est dite au fan qu'une fois tout payé. Restent au lot suivant, avec le fil Agent : la demande à la créatrice avec le type de cam (juste discuter, habillée, sexuelle) et l'envie du fan, sans lesquels elle ne valide jamais ; la proposition du créneau au fan après son accord ; le pseudo Instagram du fan, montré sur la seule fiche de la commande.

Jusque-là, l'ADR 0090 s'applique telle quelle : aucune commande ne se perd, elle attend dans « À traiter ».

## Conséquences

- L'IA vend du sur-mesure, mais seulement au prix dit par un humain, après un oui de la créatrice. Le code la retient à chaque étape.
- Migration additive : états et événements de commande, rôles `custom` et `gift`, rattachement d'un média à un fan. RLS forcée, `GRANT SELECT TO impera_service`.
- Grille (lot fait le 20/11) : table versionnée `custom_price_grids` (migration 0236, lecture et ajout d’une version par le propriétaire seul, sous la RLS de la créatrice ; le rôle de service ne fait que lire), module `custom-orders` (`GET`/`PUT /v1/creators/:creatorId/custom-prices`), calcul pur `quoteCustomOrder` dans les contrats, écran « Sur mesure » avec calculateur.
- Glossaire : « Acompte », « Dossier Perso », « Cadeau », « Relais de preuve », « Grille sur mesure », « Supplément ».
- Évals : demande avec oui, avec non, sans réponse ; pourboire juste, trop bas, spontané ; demande de pourboire hors commande ; vidéo perso proposée à un autre fan (refusée) ; type et niveau lus pour chaque type ; appel payé puis passé à un humain, sans nom de compte ni heure dans sa réponse ; cadeau trop tôt ; preuve demandée deux fois.
- Dépend de : l'agent voit les achats et les pourboires (une vente ou un pourboire rattaché au fan réveille déjà la conversation ; la mise à jour d'un média déjà lu devenu payé est en cours au fil Agent) ; la garde d'écriture ouverte pour le compte.

## Alternatives rejetées

- **Garder la règle du 11/11 (humain seul).** Plus sûr, mais une commande n'avance que si un humain est là, et Charles veut que l'IA la prenne.
- **Faire payer tout d'avance.** Plus simple, mais un fan paie moins volontiers une vidéo qu'il n'a pas vue ; la moitié est le compromis de l'agence.
- **Laisser la voix décider d'un cadeau.** Elle offrirait trop souvent, ou au mauvais moment.
