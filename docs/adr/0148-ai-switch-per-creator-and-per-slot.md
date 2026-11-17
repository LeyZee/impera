# 0148. L'IA s'allume par créatrice et par créneau du planning : un interrupteur qui dit l'état en clair, une semaine type, des exceptions datées

Statut : proposed (demande de Charles, 17/11/2026, 14 h 20 heure de Paris : « il faut un bouton global […] pour activer l'IA sur la modèle ou pas » et « activer l'IA sur certains shifts ou pas » ; forme choisie par Charles le 17/11 à 14 h 23 : « Chaque semaine + exceptions »)
Date : 2026-11-17
Amende : l'ADR 0048 § 4 (« le calendrier ne règle ni les heures ni le mode de l'agent ») pour les seules heures de l'agent, au propriétaire.
Précise : P3-14 (heures d'activité), l'ADR 0019 (verrou de l'Automatique), l'ADR 0024 (un chatteur ne change jamais le mode), l'ADR 0045 (calendrier), l'ADR 0049 (créneaux en versions datées), l'ADR 0134 § 4 (fiche en quatre onglets).

## Contexte

Ce qui existe sur main au 17/11 :

- **Le mode de l'agent par créatrice** (Automatique, Copilote, Arrêt) se règle au seul Dashboard, pour la créatrice suivie. Arrêt pose l'interrupteur d'arrêt de la créatrice ; un arrêt global l'emporte sur tout. La pastille « Agent » de la barre l'affiche sans le régler. Charles l'a cherché sur la fiche de la créatrice et ne l'a pas trouvé.
- **Les heures d'activité** (P3-14, `creators.agent_hours`) : « toujours » ou des créneaux de réponse jour par jour, chacun avec son interrupteur, au fuseau de la créatrice. Elles se saisissent heure par heure, à part du planning.
- **Le planning** (ADR 0045, 0049) a ses créneaux, en versions datées. Il montre les heures de l'agent à côté des chatteurs, en lecture seule (ADR 0048).
- **Par fan** : « Reprendre la main » dans la conversation, et l'arrêt par conversation.

Ce qui manque : un interrupteur visible là où on gère la créatrice, et le choix de l'IA créneau par créneau, sans recopier à la main des heures que le planning connaît déjà. Un outil concurrent montré par Charles saisit lui aussi les heures de l'IA à part du planning des chatteurs : quand un shift bouge, l'IA ne suit pas.

## Décision

### 1. Un interrupteur IA par créatrice, qui dit l'état en clair

- Il vit **en tête de la fiche de la créatrice** (visible sur ses quatre onglets) et sur **chaque ligne de la liste Créatrices**. C'est le même réglage que le contrôle du Dashboard, jamais un second : les trois lisent et écrivent le même mode.
- Il dit l'état en mots, jamais par une couleur seule : « IA active jusqu'à 9 h 45 », « IA hors créneau, reprend à 12 h 05 », « IA en pause jusqu'à 15 h 20 », « IA coupée », « IA coupée pour toute l'agence » (arrêt global).
- **Couper** pose l'Arrêt de la créatrice, après confirmation qui dit ce qui s'arrête et ce qui reste. **Rallumer** remet le Copilote, ou l'Automatique seulement si le verrou de l'ADR 0019 est ouvert et que c'était le mode d'avant. Rallumer ne lève jamais un arrêt global.
- **Pause rapide** : 1 h, jusqu'à demain 9 h (heure de la créatrice), ou jusqu'à ce qu'on la remette. Une pause est un arrêt de la créatrice avec une heure de fin : à cette heure, l'IA reprend sans geste, dans le mode d'avant la pause. Une pause sans fin est un Arrêt.
- Droits inchangés : propriétaire et opérateur de la créatrice ; un chatteur ne change jamais le mode (ADR 0024). La créatrice ne voit jamais cet interrupteur (ADR 0042 § 2, ADR 0048 § 2).

### 2. La semaine type : l'IA par créneau du planning

- Dans Créatrices › fiche › Compte › Heures d'activité, la liste de champs d'heures devient **une frise de la semaine** : sept lignes, les créneaux du planning dessinés dessus, les chatteurs prévus et l'IA lisibles d'un coup d'œil. On touche un créneau pour y mettre ou y retirer l'IA, chaque semaine.
- Le même geste existe dans **Équipe › Planning**, sur la ligne de chaque compte : on décide au même endroit qui tient chaque créneau.
- Les plages libres d'aujourd'hui restent possibles pour un cas à part (« Une plage à la main »), et « toujours » reste le choix par défaut.
- Stockage : rien de nouveau. Un créneau choisi s'écrit comme un créneau de réponse de `agent_hours` (jour, début, fin), avec le nom du créneau d'origine. L'agent ne lit que des heures, comme aujourd'hui.
- Quand une nouvelle version des créneaux prend effet (ADR 0049) et qu'un créneau de l'IA ne correspond plus, l'écran le dit en ambre (« le créneau Soir a changé : 18 h – 1 h au lieu de 18 h – 0 h ») et propose de l'aligner d'un geste. Rien ne s'aligne sans geste : l'IA garde ses heures.

### 3. Les exceptions datées

- Sur une date précise, on **ajoute** l'IA à un créneau (un chatteur absent mardi soir) ou on la **retire** (un live, une soirée tenue à la main). Le geste se fait sur la case du jour, dans le planning ou dans la frise.
- Une exception l'emporte sur la semaine type, pour ce créneau de cette date seulement. Une exception passée ne change plus ; une exception à venir peut être retirée.
- Une exception « IA ajoutée » n'ouvre jamais ce que l'interrupteur ferme : Arrêt, pause et arrêt global l'emportent toujours.
- Table nouvelle `agent_hour_exceptions` (créatrice, début, fin, ajout ou retrait, auteur, date) : `FORCE ROW LEVEL SECURITY`, lecture et écriture par créatrice comme `agent_hours`, fermée à la créatrice, `GRANT SELECT TO impera_service` pour le worker. Route nouvelle : balayage d'authentification, balayage d'origine, test d'isolation entre créatrices.

### 4. Ce qui ne change pas, et prime

- Un doute ouvert sur l'âge coupe l'IA ; un fan en difficulté gèle les ventes et passe à un humain. Aucun interrupteur, créneau ou exception ne les affaiblit : ils sont lus avant les heures.
- Le verrou de l'Automatique (ADR 0019) ne bouge pas : un créneau « IA » en Copilote prépare des brouillons pour le chatteur ; il ne fait parler l'IA seule qu'en Automatique ouvert.
- Hors de ses heures, l'IA garde les messages et y répond à l'ouverture suivante, comme aujourd'hui (P3-14).
- Le lien de calendrier (ADR 0045 § 5) ne porte jamais l'IA.

## Conséquences

Positives :
- On allume, coupe ou met en pause l'IA d'une créatrice là où on la gère, et on lit son état en une phrase.
- Les heures de l'IA se règlent sur les créneaux que l'équipe connaît, sans recopier d'heures ; un imprévu se règle sur une date sans toucher la semaine type.

Négatives, à surveiller :
- La semaine type copie les heures du créneau au moment du choix : un changement de créneaux demande un geste d'alignement (dit à l'écran).
- Une pause avec heure de fin ajoute une heure de reprise à l'interrupteur d'arrêt de la créatrice : sa lecture doit ignorer une pause échue partout où elle est lue (Dashboard, agent, relances, calendrier).

Mise en œuvre, en lots : (a) contrats et base, pause avec fin et exceptions (Bilan relit) ; (b) lecture des exceptions par l'agent et les relances (Agent relit) ; (c) interrupteur en tête de fiche et dans la liste, frise des heures (Design relit) ; (d) geste dans le planning (Équipe et Design relisent). Captures Nuit/Jour, PC/téléphone, sur données inventées, avis Design avant de les montrer à Charles. Sécurité relit les droits et les gardes.

## Alternatives rejetées

- **Un second bouton « IA » à côté du mode** : deux réglages qui peuvent se contredire.
- **Des heures saisies à part du planning, champ par champ** (l'outil concurrent, et notre écran actuel) : en double avec le planning, et l'IA ne suit pas un shift qui bouge.
- **Shift par shift sans semaine type** : plus de gestes chaque semaine pour un besoin surtout régulier (choix de Charles, 17/11).
- **L'IA qui suit seule les heures sans chatteur** : utile plus tard, mais elle ferait parler l'IA à des heures que personne n'a choisies ; à rouvrir quand l'Automatique sera ouvert.
