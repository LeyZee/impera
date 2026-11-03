# 0059. Écarts de persona sur Telegram : les interdits graves tout de suite, les autres au bilan du soir, jamais un nom

Statut : proposed (Charles, 03/11/2026 11h14, sur l'alerte Telegram quand un chatteur part en rouge : « fais ce qu'il y a de plus de sens et qui est cohérent au niveau métier »)
Date : 2026-11-03
Remplace : dans l'ADR 0052 § 5, la phrase « Un aveu d'IA, des coordonnées ou une promesse de rencontre partent aussi sur Telegram, en `important`, sans le nom du fan. »
Précise : l'ADR 0020 (deux sujets d'alerte et un bilan du soir de plus, un événement nouveau) et l'ADR 0052 § 5 (qui d'autre voit le rouge).
L'ADR 0052 reste telle quelle pour tout le reste ; l'index des ADR renvoie d'elle à celle-ci.

## Contexte

L'ADR 0052 relit chaque message qu'un chatteur écrit dans Reveal. Un interdit est rouge : il va au manager en poste ou, à défaut, au propriétaire, dans le Suivi, à l'instant. Seuls trois interdits partent aussi sur Telegram : l'aveu d'IA, les coordonnées et la promesse de rencontre. Les autres rouges n'y vont pas. La nuit, quand personne n'a le Suivi ouvert, un explicite avant l'âge confirmé ou une maladie inventée pour vendre attend donc le lendemain.

Charles laisse trancher (03/11). Deux écueils sont à éviter. Une alerte par message rouge ferait du bruit : un chatteur qui glisse une remise dix fois dans la nuit réveillerait dix fois le groupe, alors que rien n'est bloqué (ADR 0052 § 3). À l'inverse, se taire laisserait passer seuls, jusqu'au matin, les écarts qui mettent en danger le compte, la créatrice ou le fan.

## Décision

### 1. Tout de suite : les interdits graves

Un interdit part sur Telegram au moment où il est relevé quand il met en danger le fan, la loi, ou le compte sur la plateforme. Le niveau suit celui des relais de l'agent (ADR 0020) :

- **`urgent`** : un explicite avant l'âge confirmé (`explicit_before_age`), une promesse de rencontre (`meeting_promise`) ;
- **`important`** : un aveu d'IA (`ai_disclosure`), des coordonnées ou un autre réseau (`contact_info`), une maladie, une dette ou une urgence pour vendre (`fake_emergency`), un mensonge sur un paiement (`payment_lie`), une demande de photos intimes (`asks_for_nudes`).

La liste est dans le code de `supervision`, à côté des gardes, et un test la fige. Un interdit qui n'y figure pas ne part jamais seul.

Une seule alerte par conversation, par règle et par shift : le même interdit répété dans la même conversation ne repart pas. Un message écrit hors de tout shift prend pour clé le jour calendaire dans le fuseau du planning de l'agence. C'est `supervision` qui tranche, au commit qui enregistre l'écart, par une contrainte unique sur (conversation, règle, shift ou jour) : la décision est rejouable et Telegram ne la recalcule jamais.

### 2. Le soir : tous les rouges du jour, comptés

- Un **bilan du soir des écarts** part une fois par jour et par créatrice, à l'heure du bilan du soir des ventes (ADR 0020), sur le sujet `info`. Il compte par règle (« 3 remises, 1 culpabilisation ») les rouges relevés depuis le précédent bilan des écarts envoyé, jusqu'à l'envoi ; le premier couvre les 24 heures qui précèdent. Aucun rouge n'est ainsi compté deux fois ni perdu quand l'heure change ou qu'un envoi part en retard. Un lien ouvre le Suivi. Les rouges déjà partis tout de suite y sont comptés aussi.
- Le bilan ne donne **pas le nombre de chatteurs** : avec un seul chatteur de nuit, « 1 chatteur » le nommerait de fait. Le Suivi le donne.
- **Aucun rouge, aucun message.** L'ambre n'y figure jamais : il reste au rapport de fin de shift (ADR 0052 § 5).
- Les rouges marqués « Faux signal » restent comptés, et le bilan dit combien l'ont été.

### 3. Ce que Telegram ne dit jamais

- **Ni le fan** : ni son nom, ni son identifiant, ni l'extrait du message.
- **Ni le chatteur** : ni son nom, ni ses comptes. Le groupe n'est pas le lieu où l'on juge un membre, et un chatteur n'y lit jamais les écarts d'un autre (ADR 0043 § 7, ADR 0052 § 7). Le lien ouvre le Suivi, où le manager et le propriétaire voient qui, quoi et la correction.
- **Ni la créatrice** n'en reçoit quoi que ce soit (ADR 0042 § 2).

### 4. L'événement

- `persona_slip_flagged` { `slipId`, `conversationId`, `rule`, `notify` } est publié à chaque rouge, avec sa créatrice, au commit qui enregistre l'écart, et décrit dans `EVENT_PAYLOADS` (Zod). `rule` prend les valeurs des codes de garde du contrat. `notify` vaut `urgent`, `important` ou `null` (règle non grave, ou doublon de la même conversation, règle et shift) : Telegram rend ce que l'événement lui dit.
- L'événement ne porte **aucun identifiant de membre** : `slipId` suffit au Suivi pour retrouver le chatteur.
- Le bilan du soir des écarts est produit par le module `telegram`, comme celui des ventes. Il lit les comptes par une fonction publiée par l'index de `supervision`, lue dans la transaction de l'appelant comme `salesFeedTotals.totalsOf` (`(tx, { creatorId, from, to })`, le job du soir tournant en admin), qui ne rend que des nombres : les rouges par règle et le nombre de faux signaux.

## Conséquences

Positives :

- La nuit, le danger réveille quelqu'un, le reste attend le soir sans bruit.
- Le manager voit chaque jour si l'équipe dérape, sans qu'aucun nom ne circule dans le groupe, ni de fait par un compte de chatteurs.

Négatives, à surveiller :

- Une règle grave mal calibrée au début (faux signaux du contrôle 1) peut alerter à tort la nuit. La touche « Faux signal » et le compte du bilan servent à le voir vite.
- Deux messages sur la même faute : l'alerte grave, puis sa ligne au bilan. C'est voulu, le bilan donne le total.

## Alternatives rejetées

- **Une alerte par rouge** : trop de bruit pour un écart qui ne bloque rien.
- **Rien sur Telegram, tout au Suivi** : un explicite avant l'âge confirmé attendrait le matin.
- **Nommer le chatteur dans le groupe** : le groupe peut compter des chatteurs. Le nom reste dans le Suivi, réservé à ceux qui en ont la charge.
- **Mettre l'ambre au bilan** : la voix et les faits relèvent du coaching de fin de shift, pas du groupe d'alertes.
