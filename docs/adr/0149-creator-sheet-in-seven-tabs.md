# 0149. La fiche d'une créatrice en sept onglets : tout ce qui la concerne au même endroit, la section Scripts du menu retirée

Statut : accepted (Charles, 17/11/2026, 14 h 33 heure de Paris, choix « Oui, 7 onglets + ses notifs » sur la carte du fil Navigation)
Date : 2026-11-17
Amende : l'ADR 0134 § 1 (rail du propriétaire), § 3 (section Scripts), § 4 (fiche en quatre onglets) et § 7 (rail du manager). Le reste de l'ADR 0134 tient : sélecteur de créatrice, Suivi, Équipe, Trafic, Réglages, pastilles, icônes, redirections.
Précise : l'ADR 0042 § 7 (notifications de l'appareil et du compte), l'ADR 0099 et 0145 (coffre), l'ADR 0112 (scripts à branches), l'ADR 0137 (relances), l'ADR 0148 (interrupteur de l'IA par créatrice et par créneau).

## Contexte

Le 17/11/2026, avant que le code de l'ADR 0134 ne commence, Charles compare notre fiche créatrice à la fiche modèle de l'outil concurrent qu'il utilise : une fiche par modèle, en onglets qui suivent le travail (sa fiche, ses relances, ses horaires, ses médias par plateforme, ses scripts, ses alertes). Ce qui le déroute chez nous :

- L'onglet « Scripts » de la fiche montre le coffre (les médias) et les scripts tournés à copier dans Reveal, mais on ne peut pas y créer de script. L'éditeur de scripts à branches (ADR 0112) n'a pas encore d'écran.
- L'ADR 0134 range les scripts et le coffre dans une section du menu, à part de la fiche. Charles pense « une modèle, tout ce qui la concerne », pas « un geste, toutes les modèles ».
- Les barres de sous-onglets ne se ressemblent pas d'une section à l'autre (hauteur, alignement, comportement sur téléphone).

Il demande aussi que les alertes de pilotage d'un compte (plus de script à envoyer, vente détectée, crédit IA épuisé, offre proposée) aient leur place. Il précise que ce n'est pas à l'agence de choisir les notifications de la créatrice : c'est à elle, dans son espace.

## Décision

### 1. La fiche d'une créatrice : sept onglets, dans cet ordre

| Onglet | Ce qu'il porte | Qui le voit |
|---|---|---|
| **Persona** | Sa fiche (ADR 0079), mieux présentée : une carte par panneau. | Propriétaire |
| **IA** | L'interrupteur de l'IA et sa semaine type avec ses exceptions (ADR 0148), ses heures d'activité (P3-14), ses relances. | Propriétaire |
| **Médias** | Vue « Coffre » : le coffre par plateforme, dossiers à gauche, grille à droite, import au choix, description par IA (avec son coût) ou à la main (ADR 0145, fil Médias). Vue « Dépôts » : ce qu'elle dépose hors des scripts (l'ancien onglet Contenu). | Propriétaire, manager actif |
| **Scripts** | Vue « Scripts » : la liste de ses scripts et « Nouveau script », dont l'éditeur ne propose que des médias décrits (ADR 0112). Vue « À copier dans Reveal » : les scripts tournés, leur archive, « Copié dans Reveal ». Vue « Structures » : les structures de l'agence, au propriétaire seul. | Propriétaire, manager actif (Structures : propriétaire) |
| **Agenda** | L'agenda et, en vues du même écran, les Idées du jour, les Demandes, puis les lives (ADR 0126). | Propriétaire, manager actif |
| **Alertes** | Les alertes de pilotage de son compte : lesquelles sont actives ou en sourdine, et qui de l'équipe les reçoit. La créatrice ne voit pas cet onglet. | Propriétaire |
| **Compte** | Canal Telegram, Accès, Part de l'agence, Profil, une carte par sujet sur une seule page. | Propriétaire |

- La fiche ouvre sur le premier onglet que le compte voit : Persona pour le propriétaire, Médias pour le manager actif.
- Les relances dans l'onglet IA montrent les réglages par créatrice que l'ADR 0137 prévoit (seuils, fenêtres) et un marche/arrêt. Les règles fixées dans le code (plafonds par semaine, écarts, pauses) y sont affichées en lecture, jamais réglables.
- Le contenu des alertes (les quatre nouvelles, leur déclenchement, ce qui compte comme « offre proposée ») est décidé par le fil « Créer les alertes par créatrice ». Cette ADR ne fixe que leur place.

### 2. Le menu

- La section **Scripts** de l'ADR 0134 § 1 et § 3 n'est pas créée. Scripts, Coffre, À copier dans Reveal et Structures vivent dans la fiche (§ 1).
- **Propriétaire**, sur ordinateur : Dashboard · Chatting : Suivi, Entraîner · Agence : Créatrices, Équipe, Paie, Trafic · Réglages. Sept onglets plus Réglages. Sur téléphone : Dashboard, Suivi, Créatrices, Équipe, Plus.
- **Manager actif** : Dashboard · Chatting : Suivi · Agence : Créatrices, Équipe, Paie · Moi. Téléphone : Dashboard, Suivi, Créatrices, Équipe, Plus.
- Le sélecteur de créatrice (ADR 0134 § 2) reste en tête du menu et décide la fiche ouverte : Créatrices ouvre la fiche de la créatrice choisie sur l'onglet où on l'avait laissée (retenu sur l'appareil), et la liste quand « Toutes » est choisi. Les scripts de la créatrice en cours sont à deux clics.
- L'icône du clap passe à l'onglet Scripts de la fiche.

### 3. Une seule barre de sous-onglets

- Toutes les barres de sous-onglets du CRM (fiche créatrice, Suivi, Équipe, Paie, Moi, Trafic, Réglages) utilisent le même composant : même hauteur, même alignement sur la grille de la page, même état actif, une pastille au même endroit.
- Sur téléphone, la barre défile à l'horizontale sans barre de défilement visible, l'onglet actif est ramené en vue, et un fondu au bord indique qu'il y en a d'autres. Rien ne passe à la ligne.
- Les vues internes à un onglet (Coffre/Dépôts, Scripts/À copier dans Reveal/Structures, Agenda/Idées/Demandes) sont un sélecteur segmenté, jamais une deuxième barre d'onglets.

### 4. Ses notifications à elle

- **Alertes** (onglet de la fiche) : ce que l'équipe reçoit sur le compte d'une créatrice. Réglé par le propriétaire.
- **Notifications** (son espace, `/notifications`, déjà ouvert à tous les rôles pour l'appareil, les heures calmes et le plafond du jour) : ce qu'elle reçoit, elle. Elle y gagne le choix par sorte (une demande de l'agence, sa semaine à valider, ses gains, ses lives, selon ce que son espace envoie). L'agence n'y touche pas et ne le voit pas.
- Les deux mots ne se mélangent pas : « Alertes » pour l'agence, « Notifications » pour la personne.

### 5. Les adresses

- `/creatrices?onglet=` prend `persona` (implicite), `ia`, `medias`, `scripts`, `agenda`, `alertes`, `compte`. Les anciens onglets redirigent en gardant la créatrice : `heures` → `ia` ; `idees`, `demandes` → `agenda` (vue gardée) ; `contenu` → `medias` (vue Dépôts) ; `telegram`, `acces`, `pourcentage`, `profil` → `compte` ; `scripts` avec `dossier` → `medias` (vue Coffre, dossier gardé) ; `/creatrices/structures` → `scripts` (vue Structures).
- `CRM_RAILS` (`packages/contracts`) reste la seule source des menus et des raccourcis de la popup.

## Conséquences

- La fiche passe de 11 onglets à 7. Chacun suit un geste (qui elle est, son IA, sa matière, ses ventes, ce qu'on lui demande, ce qui sonne, son compte), et elle ne grossit plus à chaque chantier : un chantier nouveau entre dans un onglet existant.
- Le menu du propriétaire perd une section. Le chemin vers les scripts d'une créatrice passe d'un clic (ADR 0134) à deux, contre trois aujourd'hui : c'est le prix de la cohérence par créatrice, que Charles a choisi.
- Mise en œuvre par le fil Design, en lots : (1) rail, icônes, pastilles, sélecteur et barre de sous-onglets unique (lot 1 de l'ADR 0134, sans la section Scripts) ; (2) fiche en sept onglets et redirections ; (3) renommages et groupes de Réglages. Le fil Médias fournit la page du coffre (VaultPage), le fil de l'ADR 0148 l'onglet IA, le fil des scripts à branches l'éditeur, le fil des alertes par créatrice l'onglet Alertes et le choix des notifications de la créatrice. Captures Nuit/Jour, PC/téléphone avant fusion.
- Le glossaire gagne « Alertes (fiche créatrice) » et « Notifications » dans la PR du lot qui les introduit.

## Alternatives rejetées

- **Garder la section Scripts de l'ADR 0134 et seulement séparer Médias et Scripts** : un clic de moins vers les scripts, mais deux logiques de rangement dans le même menu (par geste pour les scripts, par créatrice pour le reste), ce qui est précisément ce qui perd Charles.
- **Laisser les alertes dans Réglages, réglées pour toutes les créatrices à la fois** : moins d'écrans, mais on ne peut ni mettre une alerte en sourdine pour une seule créatrice ni dire qui la reçoit.
- **Laisser l'agence régler les notifications de la créatrice** : refusé par Charles. Ce qu'elle reçoit sur son téléphone est son affaire.
