# 0121. « Mes liens » chez la créatrice, et le pilotage du trafic côté agence : paliers réglables, entonnoir par endroit, récap du jour

Statut : accepted (Charles, 16/11/2026, 2 h 30, « ok 0121 » ; le § 7 et les phrases marquées ◆, demandés à 2 h 31, acceptés à 2 h 32, « ok régularité » ; demandes de Charles du 16/11/2026, 2 h 08, 2 h 22 et 2 h 26 ; fil « Imaginer le système Instagram »)
Date : 2026-11-16
Précise : l'ADR 0120 (§ 3 : l'endroit d'un lien ; § 4 : le retour sur un Reel ; § 5 : l'entonnoir d'acquisition ; § 6 : les alertes), l'ADR 0080 § 4 (le lien de redirection), l'ADR 0042 (ce que la créatrice voit).

## Contexte

La créatrice colle chaque jour un lien dans ses stories. Aujourd'hui elle le cherche dans ses messages ou le demande à l'agence. Ses liens de redirection sont pourtant déjà enregistrés dans le CRM (ADR 0080 § 4), et chacun porte son endroit depuis l'ADR 0120.

L'agence, elle, pilote la stratégie de contenu sur un chiffre : le nombre de nouveaux abonnés par jour sur la plateforme. Elle a ses propres paliers, qui sont une méthode d'agence et n'ont pas leur place dans un dépôt public. Elle veut voir, jour après jour et sur plusieurs périodes, si le contenu amène assez de trafic, où il se perd, et ce que les derniers Reels ont donné.

Le connecteur de plateforme lit déjà les nouveaux abonnés et les ventes par jour. La plateforme expose aussi, par lien de suivi et par jour, les clics, les nouveaux abonnés et le chiffre d'affaires : avec un lien de suivi par endroit, l'entonnoir de l'ADR 0120 § 5 devient exact au lieu d'estimé.

## Décision

### 1. « Mes liens » chez la créatrice

- La créatrice a, dans son application, un écran **« Mes liens »** : une carte par lien de redirection actif qui a un endroit. Chaque carte montre le nom du lien, une **phrase d'usage** écrite par l'agence (120 caractères au plus : à quoi il sert, quand l'utiliser) et un bouton **Copier**.
- Elle ne voit que ses propres liens (RLS), ne peut ni les créer ni les modifier, et ne voit aucun chiffre de clics : c'est un outil, pas un tableau de bord (ADR 0042).
- Un lien sans endroit ou éteint n'apparaît pas. L'ordre est celui des endroits : story du jour d'abord.
- Le même bouton Copier accompagnera le rappel de story quand il existera (ADR à venir).
- L'agence règle la phrase d'usage dans l'écran des liens de redirection. La phrase ne contient jamais d'adresse (même règle que l'ADR 0080 § 4.5).
- Cet écran ne dépend ni du compte Instagram ni du connecteur de liens : il sort en premier.

### 2. Un lien de suivi par endroit

- Un lien de redirection peut être rattaché à **un lien de suivi de la plateforme**, choisi à l'écran dans la liste que le connecteur de plateforme lit déjà. Un lien de suivi n'est rattaché qu'à un seul lien de redirection.
- Quand le rattachement existe, les abonnés et les ventes de cet endroit viennent du lien de suivi : ce sont des faits. Sinon l'écran dit « non rattaché » et ne répartit rien : aucune attribution n'est fabriquée (comme l'ADR 0120 § 3).
- La lecture passe par le connecteur de plateforme existant et par les statistiques par jour déjà en place. Cette ADR n'ajoute aucun appel d'écriture vers la plateforme.

### 3. Les paliers de trafic

- L'agence règle, dans Réglages, des **paliers de trafic** (`traffic_tier`) : une liste ordonnée de seuils de nouveaux abonnés par jour, chacun avec un nom court. Ils valent pour toute l'agence et peuvent être précisés par créatrice.
- **Aucune valeur n'est écrite dans le code, une migration, un test ou une doc** : les tests et les exemples utilisent des valeurs fictives. Sans palier réglé, l'écran montre le chiffre sans couleur et propose de les régler.
- La couleur suit le design : sous le premier palier, ambre ; rouge seulement pour l'alerte du § 6.

### 4. L'écran « Trafic » de l'agence

- L'agence, et elle seule (propriétaire et manager), a un écran **« Trafic »** par créatrice. Le Dashboard porte une tuile par créatrice qui y mène : nouveaux abonnés du jour et palier atteint.
- En haut : les nouveaux abonnés par jour, face aux paliers.
- Puis l'entonnoir d'acquisition par endroit (ADR 0120 § 5) : vues des publications, clics sans robots, nouveaux abonnés, ventes.
- Trois périodes : 7, 28 et 90 jours, chacune comparée à la période précédente de même durée. Une période incomplète est dite incomplète, jamais extrapolée.
- Les derniers Reels, chacun avec son retour (ADR 0120 § 4) et les clics des heures suivantes, montrés comme un indice.
- Les graphiques suivent le système de design ; l'écran est dessiné avec le fil Design avant le code.

### 5. Le récap du jour

- Chaque matin, le code calcule pour chaque créatrice des **faits** : le palier d'hier, l'écart à la moyenne des 7 jours, l'endroit qui a le plus monté ou baissé, le rapport entre clics et abonnés face à sa médiane, le nombre de publications et de stories de la veille, le Reel le plus au-dessus et le plus en dessous de la médiane.
- Le modèle de langage écrit, à partir de ces seuls faits, un **récap** (`traffic_recap`) : trois lignes au plus (ce qui va, ce qui ne va pas, une chose à faire). Un récap qui cite un chiffre qu'il n'a pas reçu est refusé. Une cause est une piste, jamais une certitude.
- Le récap est lu dans l'écran « Trafic », et une notification de l'application prévient l'agence le matin ◆. Il n'est envoyé nulle part ailleurs avant qu'une ADR le décide, et la créatrice ne le voit pas.
- Quand une baisse des nouveaux abonnés suit un trou de publication (§ 7), le récap le dit, comme une piste. ◆
- Un jour sans données (lecture en échec) n'a pas de récap : l'écran le dit en ambre.
- Appel payant : le récap passe par le plafond du jour et le journal des appels, comme les autres.

### 6. Les alertes

- Ambre : nouveaux abonnés sous le premier palier trois jours de suite.
- Rouge : aucun nouvel abonné sur un jour entier alors que la semaine passée en comptait chaque jour.

### 7. La régularité ◆

- L'écran « Trafic » porte un bloc **« Régularité »** : le nombre de jours depuis le dernier Reel, la story du jour (oui ou non), les dépôts en retard (ADR 0055), les routines faites cette semaine. Les deux premiers viennent de la lecture du compte (ADR 0120 § 2) et comptent ce qui est en ligne, même publié à la main ; sans compte branché, ils sont dits « non lu », jamais supposés.
- L'agence règle un **délai sans publication**, en jours. Passé ce délai sans aucun Reel, l'agence reçoit une alerte ambre dans les notifications de l'application ; au double, rouge. Sans délai réglé, aucune alerte. Aucune valeur n'est écrite dans le code (comme le § 3).
- La créatrice ne reçoit pas cette alerte : ses rappels à elle relèvent d'une ADR à venir. L'agence n'est prévenue que si le silence dure.

## Ce que cette ADR ne décide pas

La publication, les Reels d'essai, la règle de réplication, les réponses aux commentaires, le calendrier de contenu et les rappels : une ADR à venir.

## Conséquences

Positives :
- La créatrice a ses liens sous le pouce, sans rien demander.
- L'agence pilote sur le chiffre qui compte, avec ses propres seuils, sans les exposer.
- Avec un lien de suivi par endroit, l'entonnoir repose sur des faits.

Négatives, à surveiller :
- Un réglage de plus à tenir par l'agence (paliers, phrases d'usage, rattachements).
- Le récap coûte un appel par créatrice et par jour.
- Tant que les liens de suivi ne sont pas rattachés, l'entonnoir s'arrête aux clics par endroit.

## Alternatives rejetées

- **Des paliers écrits dans le code** : une méthode d'agence dans un dépôt public, et impossible à ajuster.
- **Répartir les abonnés au prorata des clics** : une attribution fabriquée.
- **Montrer les clics à la créatrice** : une pression inutile, et l'ADR 0042 réserve le pilotage à l'agence.
- **Un récap écrit librement par le modèle** : il inventerait des chiffres ; le code fournit les faits.
- **Tout mettre sur le Dashboard** : il doit rester lisible d'un coup d'œil ; une tuile y suffit.
