# 0049. Créneaux libres, plusieurs chatteurs sur un compte, fans confiés ; la créatrice sans notification de shift

Statut : proposed (demandes de Charles du 02/11/2026 : 17h48 créneaux réglables, 17h52 créatrice sans notification, 18h01 un créneau réglable un à un, 18h07 deux chatteurs ou l'IA et un chatteur en même temps ; carte de 18h09 : « Fans partagés entre les deux »)
Date : 2026-11-02
Remplace : le contrat `SchedulingSettingsSchema` (`slotStartMinute` et `slotLengthMinutes`, des créneaux tous de la même durée) ; la contrainte `shifts_account_overlap_excl` (migration 0021), qui interdit deux shifts qui se chevauchent sur un compte ; dans l'ADR 0045 § 4, la puce « La créatrice choisit dans Moi si elle veut être prévenue des shifts de ses comptes ; par défaut, non » ; dans l'ADR 0025 § « Un humain qui écrit dans Reveal », « le membre en poste sur ce compte (l'auteur Reveal si la capture montre quel membre a écrit) » quand plusieurs membres y sont en poste. Précise l'ADR 0045 § 2 et § 3, l'ADR 0048 § 1 (« IA seule ») et l'ADR 0043 (à qui revient une vente).

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
- En base, une ligne par version du réglage (`effective_at timestamptz`, fuseau de la grille, créneaux), jamais un JSON écrasé : une version qui a pris effet est immuable (déclencheur), une version future se retire tant qu'elle n'a pas pris effet. Le réglage en vigueur à un instant est la dernière version dont `effective_at` est passé : par instant et non par jour, puisque « tout de suite » peut tomber en milieu de semaine ; une semaine peut donc avoir deux réglages, que la grille lit jour par jour. La lecture d'un réglage passé prend un paramètre `at`.
- Les créneaux sont en heure murale (0 à 1440 minutes) : le jour d'un changement d'heure, le créneau qui contient 2 h – 3 h dure une heure de moins ou de plus. CR-12 le teste.
- Le contrat valide la liste par un `refine` Zod (24 h sans trou ni chevauchement, de 1 h à 12 h, à l'heure pleine, au moins deux créneaux) ; le domaine le revérifie à l'écriture.

### 2. Des places : plusieurs chatteurs sur un compte

- Chaque créneau dit, compte par compte, combien de chatteurs le compte veut en même temps : 1 par défaut, 2 au plus dans le réglage. « À pourvoir » compte des **places** : un créneau qui en veut deux et n'a qu'un chatteur montre « + 2e chatteur » et compte une place.
- « IA seule » (ADR 0048) ne tient lieu que d'une place unique : un créneau qui veut deux chatteurs reste à pourvoir même quand l'agent y répond seul en Automatique.
- Un **renfort** se pose sur une case déjà prise, pour tout le créneau ou pour une partie (« 21 h – 0 h » un soir de live), sans changer le réglage : trois chatteurs au plus en même temps sur un compte. Il se lit comme un shift, avec ses heures.
- Sur la grille, une case à plusieurs chatteurs s'empile (une demi-carte par chatteur, la place libre en pointillé) et sa ligne s'agrandit ; la carte « maintenant » du compte liste chaque chatteur en poste.
- **Signal de rush**, dès que la capture Reveal donne le volume des messages : le code compare, compte par compte et heure par heure, les messages entrants des quatre dernières semaines aux places du créneau, et propose à l'agence « Soir de Lina : un 2e chatteur conseillé le mercredi » dans la carte « Cette semaine ». Une suggestion qu'un geste accepte (poser un renfort ou passer la place à 2), jamais un changement fait seul, jamais une carte de chaleur (ADR 0045). Les seuils sont des réglages, pas des constantes de prompt.
- En base, `shifts_account_overlap_excl` est retirée par une nouvelle migration, la **0063** (la 0021 n'est pas modifiée). Rien ne se perd de la garantie qu'elle donnait :
  - un **déclencheur de contrainte** `AFTER INSERT OR UPDATE`, `DEFERRABLE INITIALLY DEFERRED`, sur `shifts`, compte les shifts non annulés du compte qui se chevauchent et refuse au-delà de trois, quel que soit le chemin d'écriture (pose, glisser, ajout en masse, renfort, modèles, recalage, échange accepté de l'ADR 0031, départ d'EQ-14) ; un shift sans membre, s'il en existe, compte, puisqu'il réserve une place ;
  - le **verrou consultatif par compte** (`scheduling.account:`) évite la course entre deux transactions ; les verrous se prennent toujours dans le même ordre, d'abord ceux des comptes puis ceux des membres, chacun par ordre d'identifiant (l'ajout en masse et le recalage en prennent plusieurs), pour qu'un échange (deux membres, un compte) et un renfort (un membre, deux comptes) ne s'interbloquent pas ; un test d'intégration le prouve : deux renforts concurrents sur un compte qui en a déjà deux, un seul passe ;
  - un membre n'est toujours jamais sur deux shifts à la fois (`shifts_member_overlap_excl` reste).
- Les places vivent dans une table à part, `scheduling_slot_seats` (version du réglage, rang du créneau, `platform_account_id` en clé étrangère, `seats` avec `check (seats between 1 and 2)`), jamais dans le JSON du réglage, où un compte supprimé ou mal saisi ne se verrait pas.

### 3. Les fans confiés quand plusieurs chatteurs sont en poste

- Quand deux membres ou plus sont en poste sur un compte, Nirvana confie chaque fan à un seul d'entre eux pour la durée de leur présence commune, comptée sur les seuls shifts, sans la marge d'accès de l'ADR 0025 (pendant sa marge de fin, un membre ne garde que la passation qu'il tient). Le code décide, sans IA : un fan déjà confié garde son chatteur ; une passation en cours garde celui qui la tient ; un fan dont le dernier message humain vient de l'un d'eux lui revient ; les autres vont au moins chargé (conversations actives), puis au premier arrivé. Un membre qui part rend ses fans, répartis entre ceux qui restent.
- Chacun voit ses fans en tête dans Nirvana ; un `sale` part au chatteur à qui le fan est confié (EQ-08) ; le brief le dit. Dans Reveal, les deux voient tout : Nirvana ne peut pas l'interdire, la règle est écrite dans le brief et dans la fiche du shift.
- **À qui revient une vente.** Quand plusieurs membres sont en poste sur un compte, une vente détectée suit l'ADR 0025 à un seul changement près : là où l'ADR 0025 dit « le membre en poste sur ce compte (l'auteur Reveal si la capture montre quel membre a écrit) », elle revient au membre à qui le fan est confié à cet instant. Quand la capture montre qu'un autre membre a écrit au fan, l'agence reçoit un signal, sans changer l'attribution (Charles, carte de 18h09). Une passation prise revient toujours à celui qui l'a prise ; une vente sur une conversation que l'agent tenait revient à l'agent, sans commission. Un seul membre en poste : rien ne change à l'ADR 0025.
- **Avant la capture Reveal**, la paie lit les ventes déclarées (ADR 0023, ADR 0043) et Nirvana ne connaît pas les fans : aucun fan n'est confié. Les deux rapports d'une présence commune passent au valideur côte à côte, jamais validés seuls. Le contrôle du rapport (ADR 0043 § 4, CR-09) gagne un signal permanent : même fan et même montant déclarés par deux membres du même compte à moins de 10 minutes d'écart, signalé sur les deux rapports. Une fois les fans confiés, une vente saisie pour un fan confié à un autre membre est signalée au valideur.
- L'agent répond aux fans qu'aucun humain ne tient, comme aujourd'hui ; un message humain le fait taire sur ce fan (ADR 0025).
- En base, `shift_fan_assignments` : `creator_id` (RLS), compte, fan, membre, le shift qui la justifie, `starts_at` et `ends_at` (nul tant que l'attribution court). Un fan n'a qu'un chatteur à la fois : `exclude using gist (fan_id with =, tstzrange(starts_at, coalesce(ends_at, 'infinity')) with &&)`. La table est immuable comme les données de paie : une ligne ne change jamais, sauf pour fermer son `ends_at`, une seule fois (déclencheur), et rien ne s'efface ; un recalcul de relevé ou un nouveau contrôle de rapport retrouve la même attribution des semaines plus tard. Conservation alignée sur les relevés. RLS : isolation par créatrice ; un membre ne lit que ses lignes, le propriétaire et l'agence lisent tout ; **la créatrice ne lit rien**, puisqu'à qui un fan est confié dit qui lui écrit (ADR 0042 § 2). Un test RLS le prouve.
- « À cet instant » est l'**instant de la vente** (`occurred_at` donné par Reveal), jamais celui de sa détection. Le membre est écrit une fois sur la ligne de vente et n'est plus recalculé après la validation du relevé : une attribution corrigée plus tard ne change pas une paie validée, et l'`inputs_hash` ne bouge pas.

### 4. La créatrice voit, n'est pas prévenue

La créatrice ne reçoit aucune notification de shift ; Moi ne lui propose pas de réglage pour cela. Elle voit qui est en poste sur ses comptes et le planning de ses comptes (ADR 0045 § 1), et garde son lien de calendrier (ADR 0045 § 5). Les rappels et notifications des membres ne changent pas.

## Conséquences

- `packages/contracts` : `SchedulingSettingsSchema` porte la liste des créneaux (début et fin en minutes, nom facultatif) et leurs places par compte ; `SHIFT_SLOT_LENGTHS_MINUTES` disparaît ; lecture d'un réglage passé par `at`.
- `packages/db` : migration 0063 (versions du réglage, `scheduling_slot_seats`, retrait de `shifts_account_overlap_excl` et déclencheur de contrainte, `shift_fan_assignments`). Bilan relit.
- `scheduling` : verrou par compte, plafond de trois, renfort, recalage des modèles, « à pourvoir » en places (la fonction partagée avec EQ-14 et CR-12).
- `conversations` et EQ-08 : routage d'un `sale` vers le chatteur confié ; ADR 0043 et paie : une vente porte le membre confié ; CR-09 : le signal des ventes déclarées en double. La commission seule et l'objectif collectif ne changent pas : le net de l'équipe reste la somme des relevés. Équipe relit les montants.
- Fiches : CR-12 (lecture des places et renforts, shift à cheval), CR-13 (réglage des créneaux, places, renfort), EQ-12 (la créatrice n'a plus de motif de shift), EQ-08 (routage).
- Le glossaire gagne « Place », « Renfort » et « Fan confié » ; « Créneau » et « En poste » sont corrigés.

## Alternatives rejetées

- **Rôles « ventes » et « relation »** dans un même créneau : avec la commission seule, le chatteur relation ne toucherait rien.
- **Les deux répondent à tout, vente à l'auteur Reveal** : dépend de ce que la capture montre, et laisse deux réponses partir au même fan.
- **Des créneaux propres à chaque compte** : utile peut-être plus tard ; les places par compte couvrent déjà le rush d'une créatrice.
- **Le réglage des créneaux dans la barre d'outils de la grille** : il se touche quelques fois par an, la barre garde les gestes du jour.
- **Laisser le choix à la créatrice** (ADR 0045 § 4) : Charles, 17h52, « pour la modèle, ça ne sert à rien ».
