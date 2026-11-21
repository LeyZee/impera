# 0134. Navigation du CRM : une section Scripts, un sélecteur de créatrice, une fiche créatrice en quatre onglets, des icônes qui disent l'onglet

Statut : accepted (Charles, 16/11/2026, « ok 0134 »)
Date : 2026-11-16
Précise : 0024 (§ « Le rail dépend du rôle », § « Ce que contient chaque onglet »), 0042 § 8 (le rail de la créatrice est inchangé), 0066 § 6 (la table des menus reste partagée avec la popup)

## Contexte

Le 16/11/2026, Charles a cherché où synchroniser le coffre et où créer un script, et s'est perdu. Il a demandé une recette de la navigation : chaque onglet, chaque sous-onglet, pour chaque rôle, et des icônes qu'on comprend avant de lire le libellé. Le bilan (recette du 16/11) a montré :

- Le haut du menu tient : Dashboard, Suivi, Équipe et Paie sont à leur place et bien découpés.
- La fiche d'une créatrice porte 11 onglets (Persona, Agenda, Idées du jour, Demandes, Scripts, Contenu, Canal Telegram, Heures d'activité, Accès, Part de l'agence, Profil). Elle mélange qui elle est, ce qu'on produit avec elle chaque jour et des réglages rares. Atteindre les scripts d'une créatrice coûte 3 clics (4 sur téléphone, où Créatrices est sous « Plus »), la liste s'affichant à chaque fois.
- Les scripts sont à trois endroits : le bouton « Structures de script » (sur la liste seulement), l'onglet « Scripts » de la fiche (les scripts tournés à copier dans Reveal) et les scripts natifs. Deux choses différentes s'appellent « Scripts ». Le coffre, qui arrive, allait devenir un 12e onglet.
- Trois icônes ne disent pas leur onglet : Suivi (un compteur de vitesse), Entraîner (des étincelles), Créatrices (deux silhouettes, presque celles d'Équipe).
- Trois libellés se confondent : Réglages › Ventes (le branchement des plateformes) avec l'onglet Ventes de la créatrice ; Réglages › Telegram (les bots) avec le Canal Telegram de chaque créatrice ; Équipe › Reveal, qui ne dit pas qu'il s'agit des comptes de l'équipe.

Charles a validé la carte proposée le 16/11 à 15h37 (heure de Paris).

## Décision

### 1. Le rail du propriétaire

| Famille | Onglets, dans l'ordre | Sous-onglets |
|---|---|---|
| (tête) | Sélecteur de créatrice | « Toutes » ou une créatrice |
| — | Dashboard | inchangé |
| Chatting | Suivi | Conversations · Fans · Alertes |
| Chatting | **Scripts** (nouveau) | Scripts · Coffre · À copier dans Reveal · Structures |
| Chatting | Entraîner | Chatting · Post du canal |
| Agence | Créatrices | Persona · Agenda · Contenu · Compte |
| Agence | Équipe | Planning · Rapports · Membres · Comptes Reveal |
| Agence | Paie | inchangé |
| Agence | **Trafic** (nouveau) | Liens · Mes liens · Instagram |
| (pied) | Réglages | en quatre groupes, § 6 |

- La limite de six onglets de l'ADR 0024 devient **huit onglets plus Réglages** sur ordinateur. Les familles Chatting et Agence restent séparées par leur intertitre.
- La règle de l'ADR 0024 tient : un onglet ou un sous-onglet n'apparaît que lorsque son écran existe. Trafic, Fans et Coffre apparaissent avec leur premier écran.
- Téléphone du propriétaire : Dashboard, Suivi, Scripts, Équipe, Plus. Paie, Créatrices, Trafic, Entraîner et Réglages passent sous Plus.

### 2. Le sélecteur de créatrice

- En tête du rail (sur téléphone, en tête de l'écran), pour le propriétaire et le manager actif. Il reprend la « créatrice suivie » du Dashboard (`agent/followed.ts`) : un seul choix, retenu sur l'appareil, au lieu d'un choix par écran.
- Il s'applique au Dashboard, au Suivi, aux Scripts et à Créatrices. « Toutes » donne les vues de l'agence ; un écran qui n'a de sens que pour une créatrice demande d'en choisir une, sans en prendre une au hasard.
- Une adresse qui nomme une créatrice (`?creatrice=`) l'emporte et la sélectionne, comme aujourd'hui sur le Dashboard (PRO-28).
- Le sélecteur ne montre que les créatrices que le serveur sert au compte ; les refus du serveur restent la vraie barrière.

### 3. La section Scripts

- **Scripts** : les scripts natifs de la créatrice choisie, leurs avertissements et leurs insights. Y entrent ensuite l'éditeur de branches (ADR 0112, 0131), les paliers de dépense (ADR 0132) et la mesure des scripts.
- **Coffre** : le coffre de la créatrice et sa synchronisation. Il vit ici et non sur la fiche : c'est la matière des scripts (ADR 0099).
- **À copier dans Reveal** : l'actuel onglet « Scripts » de la fiche (SC-03 c2b) : les scripts tournés, leur archive, « Copié dans Reveal ». Le nom dit le geste et lève le doublon.
- **Structures** : l'actuel écran `/creatrices/structures`, toujours au propriétaire seul.
- Droits inchangés : le manager actif voit déjà les scripts et le contenu ; Structures reste au propriétaire.

### 4. La fiche d'une créatrice, en quatre onglets

- **Persona** (propriétaire).
- **Agenda** : l'agenda, et, en vues du même écran, les Idées du jour et les Demandes, puis les lives (ADR 0126). Tout ce qu'on lui demande, daté, au même endroit.
- **Contenu** : ce qu'elle dépose hors des scripts.
- **Compte** (propriétaire) : Canal Telegram, Heures d'activité, Accès, Part de l'agence, Profil, une carte par sujet sur une seule page.
- Le manager actif garde ce qu'il a : Agenda (avec Idées et Demandes) et Contenu ; les scripts passent dans la section Scripts.

### 5. Suivi, Équipe, Trafic

- Suivi › « Historique des alertes » devient « Alertes ». La liste des fans (ADR 0124) entre dans Suivi comme sous-onglet « Fans », pas comme une section.
- Équipe › « Reveal » devient « Comptes Reveal ».
- Trafic réunit ce qui amène des fans : le revenu par lien de tracking, « Mes liens » et Instagram (ADR 0120).

### 6. Réglages

- Les neuf pages restent au propriétaire, rangées en quatre groupes titrés (« Réglages en liste », décision de Charles du 16/11) : **Connexions** (Plateformes, Bots Telegram), **IA** (Modèles IA, Consommation IA), **Argent** (Règles de paie, Facturation), **Sécurité** (Alertes, Sauvegardes, Sécurité).
- « Ventes » devient « Plateformes » ; « Telegram » devient « Bots Telegram ».

### 7. Les autres rôles

- **Manager actif** : Dashboard · Chatting : Suivi, Scripts · Agence : Équipe, Paie, Créatrices · Moi ; ses familles prennent leur intertitre. Téléphone : Dashboard, Suivi, Équipe, Paie, Plus.
- **Chatteur**, **opérateur sans équipe**, **créatrice** : rails inchangés. Seule l'icône de Suivi change.

### 8. Les compteurs dans le rail

- Un onglet porte une pastille quand quelque chose attend le lecteur : Suivi (conversations à traiter), Équipe (rapports à valider), Paie (relevés à valider). Ce sont les compteurs déjà lus par les sous-onglets, sur les mêmes clés de requête ; un échec de lecture montre l'onglet sans pastille, jamais un chiffre faux.

### 9. Les icônes

- Suivi : deux bulles de conversation. Entraîner : une cible. Créatrices : une silhouette marquée d'une étoile. Équipe : un casque. Scripts : un clap. Trafic : un maillon.
- Dashboard, Paie, Réglages, Aujourd'hui, Planning, Contenu et Moi gardent la leur.
- Chaque icône nouvelle entre dans `NavIcon` avec son geste joué à l'activation, comme les autres (docs/design/README.md, Mouvement), et respecte le mouvement réduit.

### 10. Les adresses

- Toute adresse qui change garde une redirection de l'ancienne vers la nouvelle (liens partagés, notifications, popup de l'extension), avec la créatrice et l'onglet conservés.
- La table `CRM_RAILS` (`packages/contracts`) reste la seule source des menus et des raccourcis de la popup (ADR 0066 § 6).

## Conséquences

- Les gestes fréquents se raccourcissent : les scripts ou le coffre de la créatrice en cours en 1 clic, une autre créatrice en 1 clic de plus, Structures depuis n'importe où.
- La fiche créatrice passe de 11 à 4 onglets et ne grossit plus à chaque chantier de vente.
- Le rail du propriétaire peut atteindre 8 onglets : les intertitres de famille et l'ordre fixe le gardent lisible ; à surveiller sur les petits écrans d'ordinateur.
- Mise en œuvre par le fil propriétaire d'`apps/web` (Design), en lots : (1) rail, icônes, pastilles, sélecteur ; (2) section Scripts et redirections ; (3) fiche en quatre onglets ; (4) renommages et groupes de Réglages. Le Coffre entre dans Scripts avec le fil Médias. Captures Nuit/Jour, PC/téléphone avant fusion, comme toujours.
- Le glossaire gagne « Sélecteur de créatrice », « À copier dans Reveal » et le sens de « Plateformes » dans Réglages, dans la PR du lot qui les introduit.

## Alternatives rejetées

- **Garder la carte et ajouter des raccourcis** (palette `Ctrl+K`, dernière créatrice retenue, onglets regroupés) : moins cher, mais cache le désordre sans le régler et n'aide presque pas sur téléphone. La recherche `Ctrl+K` reste prévue plus tard, en complément.
- **Un menu personnalisable par épingles** : chaque membre aurait un menu différent, ce qui complique formation et support, pour des réglages de plus à maintenir.
- **Le Coffre et les scripts sur la fiche créatrice** : logique par objet, mais c'est le chemin le plus long pour le geste le plus fréquent.
