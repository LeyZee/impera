# 0148. L'IA d'une créatrice : un interrupteur qui dit l'état en clair, une pause rapide, et ses heures à elle dessinées sur une frise

Statut : accepted (acceptée par Charles le 19/11/2026 à 16 h 58, heure de Paris : « ok 0148 » ; demande de Charles, 17/11/2026, 14 h 20 heure de Paris : « il faut un bouton global […] pour activer l'IA sur la modèle ou pas » et « activer l'IA sur certains shifts ou pas » ; forme choisie le même jour à 14 h 23 : « Chaque semaine + exceptions » ; précisée à 14 h 34 : « les shifts des chatteurs et les shifts des IA, c'est deux choses différentes […] l'IA n'a pas besoin d'avoir des shifts comme des chatteurs »)
Date : 2026-11-17
Précise : P3-14 (heures d'activité), l'ADR 0126 § 13 et § 17 (heures récurrentes et exceptions datées de l'agent, ordre de priorité), l'ADR 0019 (verrou de l'Automatique), l'ADR 0024 (un chatteur ne change jamais le mode), l'ADR 0149 (onglet IA de la fiche). Ne remplace rien.

## Contexte

Ce qui existe sur main au 17/11 :

- **Le mode de l'agent par créatrice** (Automatique, Copilote, Arrêt) se règle au seul Dashboard, pour la créatrice suivie ; la pastille « Agent » de la barre l'affiche sans le régler. Charles l'a cherché sur la fiche de la créatrice et ne l'a pas trouvé.
- **Les heures d'activité** (P3-14, `creators.agent_hours`) : « toujours » ou des plages par jour de la semaine, chacune avec son interrupteur, au fuseau de la créatrice. L'écran les saisit en champs d'heures.
- **L'ADR 0126 § 13** a décidé que ces heures sont les heures récurrentes de l'agent et qu'on y ajoute des plages et des exceptions **datées** ; § 17 fixe l'ordre : live > arrêt > shift d'un chatteur > plage datée de l'agent > heures d'activité. Rien de cela n'est encore codé.

Charles veut un interrupteur visible là où on gère la créatrice, et régler les heures de l'IA semaine par semaine avec des exceptions. Il précise que les heures de l'IA ne sont **pas** des shifts de chatteur : elles n'ont ni durée type ni lien avec les créneaux du planning.

## Décision

### 1. Un interrupteur IA par créatrice, qui dit l'état en clair

- En tête de la fiche de la créatrice, visible sur tous ses onglets, et sur chaque ligne de la liste Créatrices. C'est le même réglage que le contrôle du Dashboard, jamais un second.
- Il dit l'état en mots : « IA active · Copilote, jusqu'à 9 h 45 », « IA hors de ses heures, reprend demain à 0 h », « IA en pause jusqu'à 15 h 29 », « IA coupée », « IA coupée pour toute l'agence ».
- **Couper** pose l'Arrêt de la créatrice, après une confirmation qui dit ce qui s'arrête et ce qui reste. **Rallumer** remet le mode d'avant (Automatique seulement si le verrou de l'ADR 0019 est ouvert), et ne lève jamais un arrêt global.
- **Pause rapide** : 1 h, jusqu'à demain 9 h (heure de la créatrice), ou jusqu'à ce qu'on la remette. Une pause est un Arrêt de la créatrice avec une heure de fin : à cette heure, l'IA reprend seule dans le mode d'avant.
- Droits inchangés : propriétaire et opérateur de la créatrice ; un chatteur ne change jamais le mode. La créatrice ne voit jamais cet interrupteur (ADR 0042 § 2, ADR 0048 § 2).

### 2. Ses heures à elle, dessinées sur une frise

- Dans l'onglet IA de la fiche (ADR 0149), les champs d'heures deviennent **une frise de la semaine** : sept jours de 0 h à 24 h, chacun sur deux lignes, « IA » et « Équipe ».
- **On clique, on ne glisse pas** (Charles, 17/11 14 h 52 : le glisser était difficile, surtout sur un petit écran). Un clic sur une plage ouvre une fenêtre : deux grandes cases « De » et « À », une grille des 24 heures et les minutes (:00, :15, :30, :45) ; choisir le début passe tout seul à la fin, et la plage change de taille à l'écran pendant qu'on règle. Un clic sur un endroit vide de la ligne IA ajoute une plage de 2 h (annoncée au survol) et ouvre la même fenêtre.
- **Supprimer se voit** : une croix sur la plage (au survol, et toujours sur la plage ouverte) et « Supprimer » dans la fenêtre ; une barre en bas dit « Plage supprimée » avec « Annuler » pendant 5 s, au lieu d'une confirmation.
- **Fusionner** : deux plages qui se touchent ou se chevauchent deviennent une seule, et l'écran le dit. Quand une autre plage est à 4 h ou moins, la fenêtre propose « Relier » pour combler l'écart. « Mettre la même plage aussi le » recopie une plage sur d'autres jours.
- **Couleurs** (design system) : l'IA en violet `--nv-agent`, comme dans le calendrier (ADR 0048), jamais en rouge, réservé aux urgences et au bouton principal ; les chatteurs en doré `--nv-data-2` ; « personne ne répond » en ambre `--nv-warning`, en pointillés, car c'est un avertissement ; le live de la créatrice en rose (jeton `--nv-creator` à ajouter, la couleur de la part des créatrices au Dashboard). Une légende en pastilles au-dessus de la frise.
- Les heures de l'IA ne dépendent pas des shifts des chatteurs. La ligne « Équipe », en dessous, dit en clair qui est en shift (« Kévin 14 h – 19 h ») et où **personne ne répond** (pointillés ambre), **pour repère seulement**. Un geste « Mettre l'IA là où personne ne répond » remplit ces trous d'un coup ; ensuite, les plages vivent seules.
- Les lives prévus de la créatrice (ADR 0126) sont dessinés sur la frise : l'IA s'y tait d'elle-même, sans réglage.
- **Une plage peut passer minuit** (22 h – 4 h) : elle finit « le lendemain », sans être coupée en deux jours ; la suite se dessine au début du jour suivant.
- **Quand ses fans écrivent** : le fond de la ligne IA s'éclaire selon le nombre moyen de messages de fans par heure, jour par jour, sur les 4 dernières semaines (lu dans les messages déjà en base, sans nouvelle table). Masquable.
- **Ordre de l'écran** (du plus utile au détail) : l'état de l'IA en tête de fiche ; puis les chiffres, en premier les messages de fans par semaine tombés quand personne ne répond (le chiffre à faire baisser), puis heures de l'IA seule, heures où elle aide un chatteur, coût IA estimé par semaine d'après la consommation réelle de la créatrice, à côté du plafond du jour ; puis la suggestion de trou (ci-dessous) ; puis les réglages, la légende et la frise.
- **Le trou qui coûte le plus** : quand un trou d'au moins 2 h sans IA ni chatteur reçoit, sur la semaine, au moins 8 messages de fans (moyenne des 4 dernières semaines), une ligne ambre le nomme au-dessus de la frise (« Personne ne répond samedi, de 19 h à 23 h · ≈ 44 messages par semaine · coût si l'IA le couvre ≈ … ») avec « Mettre l'IA sur ce trou » et « Laisser comme ça ». Un seul trou à la fois, le plus chargé ; c'est une suggestion dans la page, pas une notification.
- **Pas de mode par plage** : la frise ne choisit pas entre Automatique et Copilote, c'est déduit. Pendant le shift d'un chatteur, l'IA lui prépare ses brouillons ; seule, elle répond si l'Automatique est ouvert pour la créatrice, sinon elle prépare et ses réponses attendent le prochain shift. Tant que l'Automatique n'est pas ouvert, l'écran le dit en une ligne et le chiffre « L'IA seule » dit « elle prépare, un chatteur envoie ».
- L'interrupteur dit aussi qui répond quand l'IA ne répond pas (« Kévin répond jusqu'à 19 h · l'IA reprend cette nuit à 0 h ») et combien de fans attendent sa reprise.
- Sous la frise : qui a changé les heures en dernier, et quand (le changement est journalisé avec l'avant et l'après).
- « 24 h / 24 » est un bouton, pas un réglage à part : enfoncé, l'IA répond à toute heure ; relâché, ses plages reviennent telles qu'elles étaient.
- Stockage de la semaine type : `creators.agent_hours`, tel quel.

### 2 bis. La vue agence

- Dans Équipe › Planning, une page « L'IA de toutes les créatrices » : une ligne par créatrice, avec sa journée en mini-frise (l'IA en violet, les shifts en traits dorés, les trous en ambre), son état (« l'IA aide Kévin », « personne ne répond »), son interrupteur, ses messages de fans sans réponse et son coût IA du jour. Un sélecteur de jour, aujourd'hui par défaut.
- Les créatrices où des fans restent sans réponse passent en haut.
- En tête : messages sans réponse de toute l'agence, coût IA du jour de toute l'agence face au plafond de 20 € (prévenu au-dessus de 14 €), nombre de créatrices avec l'IA allumée.
- On y regarde et on coupe ; les heures se règlent dans la fiche (clic sur le nom). Mêmes droits que l'interrupteur de la fiche ; les chatteurs n'y voient pas les coûts.

### 3. Une date qui change : l'exception

- Le sélecteur « Semaine type / Cette semaine » fait porter le même geste sur une date seulement. Un jour modifié porte « Modifié ce jour » et un bouton « Rétablir ».
- Une exception **remplace** les plages d'un jour daté de la créatrice (à son fuseau) ; une liste vide veut dire « pas d'IA ce jour-là ». C'est la plage datée et l'exception datée de l'ADR 0126 § 13, sous une seule forme.
- Une exception passée ne change plus ; une exception à venir peut être rétablie.
- Une exception n'ouvre jamais ce que l'interrupteur ferme : Arrêt, pause et arrêt global l'emportent toujours (ordre de l'ADR 0126 § 17).
- Table nouvelle `agent_hour_exceptions` (créatrice, date locale, plages, auteur, date d'écriture), une ligne par créatrice et par date : `FORCE ROW LEVEL SECURITY`, mêmes droits que `agent_hours`, fermée à la créatrice, `GRANT SELECT TO impera_service`. Route nouvelle : balayage d'authentification, balayage d'origine, test d'isolation entre créatrices.

### 4. Ce qui ne change pas, et prime

- Un doute ouvert sur l'âge coupe l'IA ; un fan en difficulté gèle les ventes et passe à un humain. Aucun interrupteur, aucune plage ni exception ne les affaiblit.
- Le verrou de l'Automatique (ADR 0019) ne bouge pas : en Copilote, une plage de l'IA prépare des brouillons ; l'IA ne répond seule qu'en Automatique ouvert. Pendant le shift d'un chatteur, l'ADR 0126 § 14 et § 16 s'appliquent.
- Hors de ses heures, l'IA garde les messages et y répond à l'ouverture suivante (P3-14).
- Le lien de calendrier (ADR 0045 § 5) ne porte jamais l'IA.

## Conséquences

Positives :
- On allume, coupe ou met en pause l'IA d'une créatrice là où on la gère, et on lit son état en une phrase.
- Les heures de l'IA se dessinent en quelques gestes, à côté des shifts des chatteurs mais sans en dépendre ; un imprévu se règle sur une date sans toucher la semaine type.

Négatives, à surveiller :
- La pause ajoute une heure de fin à l'arrêt de la créatrice : toute lecture de l'arrêt (Dashboard, agent, relances, calendrier) doit ignorer une pause échue.
- Sur téléphone, la frise de 24 h est trop étroite pour être touchée : chaque jour s'y lit en liste de plages, avec la même fenêtre de réglage.

Mise en œuvre, en lots : (a) contrats et base, pause avec fin et exceptions (Bilan) ; (b) lecture des exceptions par l'agent et les relances (Agent) ; (c) interrupteur, pause et frise (Design) ; (d) les plages et exceptions de l'IA visibles dans le planning, et la vue agence (Équipe, avec l'ADR 0126). Captures Nuit/Jour, PC/téléphone, sur données inventées, avis Design avant Charles ; Sécurité relit droits et gardes.

## Alternatives rejetées

- **Un second bouton « IA » à côté du mode** : deux réglages qui peuvent se contredire.
- **L'IA réglée sur les créneaux du planning** (première proposition du 17/11) : refusée par Charles, l'IA n'a pas de shift type.
- **Des heures saisies champ par champ** (écran actuel, et l'outil concurrent montré par Charles) : lent, et on ne voit pas la semaine.
- **Un compteur « coupée par un live »** : rare, il ne pilote rien ; remplacé par les messages de fans sans réponse.
- **Un mode par plage réglé à la main** (Automatique la nuit, Copilote le jour) : il se déduit déjà de qui est là ; un réglage de plus pourrait contredire le verrou de l'Automatique.
- **Une notification pour chaque trou** : du bruit ; la suggestion dans la page suffit. Si Charles la veut aussi en alerte, elle entre dans le catalogue des alertes par créatrice, pas ici.
- **Plages datées et exceptions datées séparées** : une seule forme (les plages du jour daté) dit la même chose avec moins de règles.
