# 0049. Créneaux libres, plusieurs chatteurs sur un compte, fans confiés ; la créatrice sans notification de shift

Statut : proposed (demandes de Charles du 02/11/2026 : 17h48 créneaux réglables, 17h52 créatrice sans notification, 18h01 un créneau réglable un à un, 18h07 deux chatteurs ou l'IA et un chatteur en même temps ; carte de 18h09 : « Fans partagés entre les deux »)
Date : 2026-11-02
Remplace : le contrat `SchedulingSettingsSchema` (`slotStartMinute` et `slotLengthMinutes`, des créneaux tous de la même durée) ; la contrainte `shifts_account_overlap_excl` (migration 0021), qui interdit deux shifts qui se chevauchent sur un compte ; dans l'ADR 0045 § 4, la puce « La créatrice choisit dans Moi si elle veut être prévenue des shifts de ses comptes ; par défaut, non » ; dans l'ADR 0025 § « Un humain qui écrit dans Reveal », « le membre en poste sur ce compte » quand plusieurs membres y sont en poste. Précise l'ADR 0045 § 2 et § 3, l'ADR 0048 § 1 (« IA seule ») et l'ADR 0043 (à qui revient une vente).

## Contexte

Les créneaux du planning se règlent aujourd'hui par une heure de départ et une seule durée (4 × 6 h par défaut, EQ-02) ; un compte n'a jamais deux membres en même temps, et la base l'interdit. Après avoir validé le prototype du calendrier (17h47), Charles a demandé :

- de régler les heures des créneaux, chacun les siennes, d'en ajouter et d'en retirer, la grille suivant le réglage (17h48, 18h01) ;
- que la créatrice n'ait aucune notification de shift : « juste besoin de voir qui shift en ce moment, et le planning » (17h52) ;
- de pouvoir mettre deux chatteurs sur un compte quand le trafic l'exige, ou l'IA et un chatteur, et de voir comment le planning le montre (18h07).

Le prototype (https://claude.ai/artifact/8AJCiUp1ZoEXEvfx9wknPE, données inventées) montre les trois. Deux chatteurs sur un même compte posent la question de l'argent : à qui revient une vente quand deux membres sont en poste. Charles a choisi le partage des fans (carte de 18h09).

## Décision

### 1. Des créneaux aux heures libres, réglés rarement

- Les créneaux de la journée sont une liste ordonnée qui couvre 24 h sans trou ni chevauchement, chacun d'une durée de 1 h à 12 h, à l'heure pleine, dans le fuseau de la grille. Chaque créneau a un nom facultatif (« Live ») ; sans nom, le code le nomme d'après ses heures (Nuit, Matin, Midi, Après-midi, Soir). Au moins deux créneaux.
- Le propriétaire les règle dans les réglages du planning, hors de la barre d'outils de la grille : une frise de 24 h où l'on glisse les coupures, et une carte par créneau (nom, début, fin, durée, retrait), « Ajouter un créneau » coupe le plus long en deux, quelques modèles de journée. La grille suit chaque geste en aperçu ; rien n'est écrit avant « Enregistrer ».
- Un réglage est daté : il prend effet un lundi choisi, ou tout de suite pour les créneaux qui n'ont pas commencé. Rien n'est rétroactif. Un shift passé garde son créneau d'alors.
- Les shifts posés à la main ne bougent jamais : ils gardent leurs heures et s'affichent avec elles ; un shift qui ne tombe plus pile dans un créneau est signalé à l'agence. Un shift à cheval sur deux créneaux se dessine sur les deux.
- « Recaler la semaine modèle » (coché par défaut) : chaque modèle de shift qui tenait un créneau est terminé à la date d'effet et remplacé par un modèle aux nouvelles heures de ce créneau, même membre, même compte ; les shifts déjà posés par ces modèles et pas encore commencés sont retirés puis reposés, et leurs membres prévenus, comme pour « Faire de cette semaine le modèle » (ADR 0045 § 3). Un créneau retiré rend ses heures au créneau d'avant.
- Les heures de l'agent ne changent pas : elles se relisent sur les nouveaux créneaux (ADR 0048).

### 2. Des places : plusieurs chatteurs sur un compte

- Chaque créneau dit, compte par compte, combien de chatteurs le compte veut en même temps : 1 par défaut, 2 au plus dans le réglage. « À pourvoir » compte des **places** : un créneau qui en veut deux et n'a qu'un chatteur montre « + 2e chatteur » et compte une place.
- « IA seule » (ADR 0048) ne tient lieu que d'une place unique : un créneau qui veut deux chatteurs reste à pourvoir même quand l'agent y répond seul en Automatique.
- Un **renfort** se pose sur une case déjà prise, pour tout le créneau ou pour une partie (« 21 h – 0 h » un soir de live), sans changer le réglage : trois chatteurs au plus en même temps sur un compte. Il se lit comme un shift, avec ses heures.
- Sur la grille, une case à plusieurs chatteurs s'empile (une demi-carte par chatteur, la place libre en pointillé) et sa ligne s'agrandit ; la carte « maintenant » du compte liste chaque chatteur en poste.
- **Signal de rush**, dès que la capture Reveal donne le volume des messages : le code compare, compte par compte et heure par heure, les messages entrants des quatre dernières semaines aux places du créneau, et propose à l'agence « Soir de Lina : un 2e chatteur conseillé le mercredi » dans la carte « Cette semaine ». Une suggestion qu'un geste accepte (poser un renfort ou passer la place à 2), jamais un changement fait seul, jamais une carte de chaleur (ADR 0045). Les seuils sont des réglages, pas des constantes de prompt.
- En base, `shifts_account_overlap_excl` est retirée. Le serveur décide sous un verrou par compte (`scheduling.account:`, à côté du verrou par membre) qu'un compte n'a jamais plus de trois shifts non annulés qui se chevauchent ; un membre n'est toujours jamais sur deux shifts à la fois (`shifts_member_overlap_excl` reste). Les places vivent dans le réglage daté du § 1. Nouvelle migration, numéro attribué par Bilan.

### 3. Les fans confiés quand plusieurs chatteurs sont en poste

- Quand deux membres ou plus sont en poste sur un compte, Nirvana confie chaque fan à un seul d'entre eux pour la durée de leur présence commune. Le code décide, sans IA : un fan déjà confié garde son chatteur ; une passation en cours garde celui qui la tient ; un fan dont le dernier message humain vient de l'un d'eux lui revient ; les autres vont au moins chargé (conversations actives), puis au premier arrivé. Un membre qui part rend ses fans, répartis entre ceux qui restent.
- Chacun voit ses fans en tête dans Nirvana ; un `sale` part au chatteur à qui le fan est confié (EQ-08) ; le brief le dit. Dans Reveal, les deux voient tout : Nirvana ne peut pas l'interdire, la règle est écrite dans le brief et dans la fiche du shift.
- **La vente revient au chatteur à qui le fan est confié à cet instant** (Charles, carte de 18h09). Quand la capture Reveal montre qu'un autre membre a écrit au fan, l'agence reçoit un signal, sans changer l'attribution. Un seul membre en poste : rien ne change à l'ADR 0025.
- L'agent répond aux fans qu'aucun humain ne tient, comme aujourd'hui ; un message humain le fait taire sur ce fan (ADR 0025).

### 4. La créatrice voit, n'est pas prévenue

La créatrice ne reçoit aucune notification de shift ; Moi ne lui propose pas de réglage pour cela. Elle voit qui est en poste sur ses comptes et le planning de ses comptes (ADR 0045 § 1), et garde son lien de calendrier (ADR 0045 § 5). Les rappels et notifications des membres ne changent pas.

## Conséquences

- `packages/contracts` : `SchedulingSettingsSchema` porte la liste datée des créneaux (début et fin en minutes, nom facultatif, places par compte) ; `SHIFT_SLOT_LENGTHS_MINUTES` disparaît. Lecture d'un réglage passé pour afficher les semaines passées.
- `packages/db` : migration du réglage daté et des places, retrait de `shifts_account_overlap_excl`, table des fans confiés (`shift_fan_assignments` : compte, fan, membre, depuis, jusqu'à). Bilan relit.
- `scheduling` : verrou par compte, plafond de trois, renfort, recalage des modèles, « à pourvoir » en places (la fonction partagée avec EQ-14 et CR-12).
- `conversations` et EQ-08 : routage d'un `sale` vers le chatteur confié ; ADR 0043 et paie : une vente porte le membre confié, Équipe relit les montants.
- Fiches : CR-12 (lecture des places et renforts, shift à cheval), CR-13 (réglage des créneaux, places, renfort), EQ-12 (la créatrice n'a plus de motif de shift), EQ-08 (routage).
- Le glossaire gagne « Place », « Renfort » et « Fan confié » ; « Créneau » et « En poste » sont corrigés.

## Alternatives rejetées

- **Rôles « ventes » et « relation »** dans un même créneau : avec la commission seule, le chatteur relation ne toucherait rien.
- **Les deux répondent à tout, vente à l'auteur Reveal** : dépend de ce que la capture montre, et laisse deux réponses partir au même fan.
- **Des créneaux propres à chaque compte** : utile peut-être plus tard ; les places par compte couvrent déjà le rush d'une créatrice.
- **Le réglage des créneaux dans la barre d'outils de la grille** : il se touche quelques fois par an, la barre garde les gestes du jour.
- **Laisser le choix à la créatrice** (ADR 0045 § 4) : Charles, 17h52, « pour la modèle, ça ne sert à rien ».
