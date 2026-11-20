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

1. **Les états, dans le code** (`agent/domain/custom-order.ts`) : `asked` → `creator_yes` (avec prix) ou `creator_no` → `deposit_paid` → `delivered`, et `expired` / `cancelled`. Un appel ou une visio suit le § D (paiement entier d'avance). Chaque passage est un événement de conversation, idempotent.
2. **`asked`.** L'IA répond avec la réponse d'attente actuelle, sous la garde `no_commitment`. La demande part à la créatrice : un résumé en une phrase de ce qu'il veut voir, écrit par le code à partir du brief, jamais son pseudo ni son texte brut. Tant que l'espace de la créatrice n'est pas en ligne, elle part au propriétaire, qui saisit la réponse.
3. **`creator_yes`.** Seul un humain (la créatrice, ou le propriétaire pour elle) saisit le oui et le prix. Le modèle ne fixe jamais un prix. L'IA annonce le prix exact et demande un pourboire de la moitié pour prendre la commande. La garde `no_commitment` est levée pour ce prix-là seulement, et la garde `price_outside_offer` laisse passer ce seul montant (`GuardContext.allowedPriceMinor`) ; « jamais de négociation » s'applique.
4. **Le pourboire n'est demandé qu'ici.** Une garde de voix bloque toute demande de pourboire hors d'une commande à l'état `creator_yes`. Un remerciement pour un pourboire spontané reste permis.
5. **`deposit_paid`.** Le code reconnaît un pourboire de ce fan, d'au moins la moitié du prix, arrivé après l'annonce. Un montant plus bas ou ambigu passe à un humain.
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

14. Rangée dans les réglages de l'agent de la version de persona (`agent.custom_price_grid`), comme la banque de répliques : propriétaire seul en lecture et écriture, jamais dans le dépôt, jamais entière dans un prompt (seule la ligne utile entre, dans un bloc typé).
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

Rien n'est codé par cette ADR. Le code vient en petits lots, après la première vente réelle (décision de Charles du 20/11 : freiner les nouveaux écrans tant que le cœur n'est pas prouvé) :

1. Oui ou non et prix de la créatrice saisis sur la ligne « Demande sur mesure » d'« À traiter » ; annonce du prix et demande d'acompte ; pourboire reconnu ; garde « pourboire seulement ici » ; relais de preuve (§ F).
2. Dossier `custom` rattaché au fan, livraison au prix restant (§ B, § A.6).
3. Grille interne (§ C).
4. Cadeaux (§ E).
5. Plus tard : cam (après relevé de ce que Reveal permet), vocaux préparés, réponse de la créatrice depuis son espace.

Jusque-là, l'ADR 0090 s'applique telle quelle : aucune commande ne se perd, elle attend dans « À traiter ».

## Conséquences

- L'IA vend du sur-mesure, mais seulement au prix dit par un humain, après un oui de la créatrice. Le code la retient à chaque étape.
- Migration additive : états et événements de commande, rôles `custom` et `gift`, rattachement d'un média à un fan. RLS forcée, `GRANT SELECT TO impera_service`.
- Glossaire : « Acompte », « Dossier Perso », « Cadeau », « Relais de preuve ».
- Évals : demande avec oui, avec non, sans réponse ; pourboire juste, trop bas, spontané ; demande de pourboire hors commande ; vidéo perso proposée à un autre fan (refusée) ; type et niveau lus pour chaque type ; appel payé puis passé à un humain, sans nom de compte ni heure dans sa réponse ; cadeau trop tôt ; preuve demandée deux fois.
- Dépend de : l'agent voit les achats et les pourboires (une vente ou un pourboire rattaché au fan réveille déjà la conversation ; la mise à jour d'un média déjà lu devenu payé est en cours au fil Agent) ; la garde d'écriture ouverte pour le compte.

## Alternatives rejetées

- **Garder la règle du 11/11 (humain seul).** Plus sûr, mais une commande n'avance que si un humain est là, et Charles veut que l'IA la prenne.
- **Faire payer tout d'avance.** Plus simple, mais un fan paie moins volontiers une vidéo qu'il n'a pas vue ; la moitié est le compromis de l'agence.
- **Laisser la voix décider d'un cadeau.** Elle offrirait trop souvent, ou au mauvais moment.
