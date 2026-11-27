# 0094. Alertes de pilotage : Impera prévient aussi des problèmes de business

Statut : accepted (« ok 0094 » de Charles le 12/11/2026, 23 h 18 ; « applique tout » de Charles le 12/11/2026, 23 h 11 ; rédigée par le fil « Trouver les trous de pilotage d'agence » ; versée au dépôt le 20/11/2026)
Date : 2026-11-12
Précise : 0020 (notifications Telegram), P4-01 (alertes de la créatrice), 0045 et 0049 (planning, places), 0078 (registre). Ne remplace rien.

## Contexte

Les alertes d'aujourd'hui couvrent les fans (mots d'alerte, passations, doute d'identité, demande de service), l'IA (budget, coupe-circuit), la technique (session, sauvegarde, connexion Reveal) et la paperasse (factures). Aucune ne dit qu'un compte n'est couvert par personne, qu'un chatteur n'est pas là au début de son shift, qu'une créatrice décroche ou que les remboursements montent. Le directeur l'apprend en ouvrant le Dashboard, trop tard.

## Décision

1. **Quatre signaux**, chacun réglable et coupable par créatrice dans Réglages › Alertes, valeurs par défaut prudentes (Charles, Q3). Les valeurs des seuils sont des réglages de l'agence : elles ne s'écrivent pas dans le dépôt.
   - **Compte sans personne** : à l'heure de début d'une plage où aucun chatteur n'est en poste et où l'agent n'est pas en Automatique, alors que le compte a reçu au moins un message de fan dans les 24 h. Une alerte par plage, pas une par minute.
   - **Chatteur pas là** : un shift a commencé depuis un délai réglable et le membre n'a ouvert ni le CRM ni l'extension depuis le début du shift. Une seule alerte par shift ; l'extension qui se connecte la referme (« Chatteur Un est arrivé à 14 h 22 »).
   - **Créatrice qui décroche** : chiffre des 7 derniers jours complets inférieur, d'un écart réglable, à la moyenne des quatre semaines d'avant, avec un nombre minimal de ventes sur ces quatre semaines. Une fois par jour au plus, le matin, heure de l'agence.
   - **Remboursements** : sur 7 jours, une part du chiffre et un nombre de remboursements au-delà de seuils réglables. Une fois par jour au plus.
2. **Plus tard, avec la messagerie** : « gros payeur sans réponse » (un des payeurs de tête de 0092 § 3 attend depuis un délai réglable en poste). Prévu ici, codé quand le connecteur lit les messages.
3. **Où elles vont.** Sujet « important » de Telegram (0020) ; la même ligne dans la liste « À faire » du Dashboard (W3) jusqu'à ce que la cause disparaisse. Jamais à un chatteur ni à la créatrice.
4. **Ce qu'elles ne font pas.** Aucune ne change la paie, le planning ou le mode de l'agent. Elles préviennent, un humain décide.

## Conséquences

- Positives : les trous de couverture et les décrochages se voient le jour même.
- Négatives : une table de réglages par créatrice et par signal (migration) ; « pas là » dépend de la présence en ligne, qu'un chatteur peut fausser en ouvrant le CRM sans travailler.
- À surveiller : le bruit. Si une alerte sonne plus d'une fois par jour en moyenne sur deux semaines, revoir son seuil par défaut.

## Alternatives rejetées

- Une alerte « chiffre par heure trop bas » : elle pousserait à juger un chatteur sur une heure creuse ; la vue de 0092 § 1 suffit.
- Des seuils fixés dans le code : Charles veut pouvoir les régler.

## Mise en œuvre (note de versement, 20/11/2026)

L'ADR a été acceptée le 12/11 mais n'avait pas été versée au dépôt ; elle l'est telle quelle, à une réserve près : les valeurs chiffrées des seuils du brouillon restent hors du dépôt public, comme réglages.

Depuis, l'ADR 0150 a donné à chaque créatrice un onglet Alertes où l'on choisit, par rôle (propriétaire, manager, chatteur en shift), si une alerte sonne, arrive en sourdine ou n'arrive pas. Les signaux de pilotage y entrent comme des lignes de plus : c'est là qu'on les coupe pour une créatrice. Leur ligne « chatteur en shift » est fermée, verrouillée sur « rien », pour tenir le § 3.

Lots :

- **a** : « Compte sans personne ». La « plage » est un créneau du planning (ADR 0049) ; il est sans personne quand le planning le compte « à pourvoir » à son début (`slotsToFill`, la même règle que le calendrier : un créneau tenu par l'agent en Automatique n'y est pas). Un événement par compte et par créneau (index unique), routé par l'onglet Alertes et dit dans le sujet « important » de Telegram.
- **b** : « Chatteur pas là », quand la prise de poste (EQ-12) existe.
- **c** : « Créatrice qui décroche » et « Remboursements », avec la table des réglages par créatrice et par signal.
- **d** : la ligne dans « À faire » du Dashboard, réservée au propriétaire et aux managers.

### Avenant du 27/11/2026 : lot b versé

« Chatteur pas là » se lit sur la prise de poste (EQ-12, « Je prends mon poste ») et non sur la présence en ligne : un shift non annulé, ni pris ni arrêté, tenu par un membre actif qui suit encore la créatrice, dont le début remonte au délai réglé et qui n'est pas fini. La présence en ligne se fausse en ouvrant le CRM ; la prise de poste est un geste daté. Un shift dont le membre n'est plus actif ou ne suit plus la créatrice est déjà « à pourvoir » : c'est « Compte sans personne » qui le dit.

Le délai est, pour ce lot, un seul réglage de l'agence (Réglages › Alertes, section « Pilotage »), entre 5 et 240 minutes, réglé par le propriétaire. Il n'a pas de valeur par défaut : tant qu'il n'est pas choisi, rien ne part, et l'écran le dit en ambre. Un délai par créatrice viendra avec la table de réglages du lot c. Un événement `shift_not_taken` par shift (index unique) ; le job relit la demi-heure écoulée toutes les cinq minutes. Restent pour plus tard : l'avis « arrivé à 14 h 22 » quand le membre prend son poste en retard, et la liste des membres libres sur le créneau (EQ-12).
