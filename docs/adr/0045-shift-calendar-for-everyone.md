# 0045. Calendrier des shifts : toute l'équipe et la créatrice voient qui chatte quand, l'agence pose et déplace au doigt

Statut : proposed (décisions de Charles du 02/11/2026 16h44 ; à accepter par Charles)
Date : 2026-11-02
Remplace : dans l'ADR 0031 § Échanges, la phrase « C'est la seule porte par laquelle un chatteur lit le planning d'un autre. » Précise l'ADR 0024 (le Planning du chatteur montre « le sien, celui de l'équipe »), l'ADR 0042 § 2 et § 4 (ce que la créatrice voit de qui est en poste), et les fiches EQ-02, EQ-12 et EQ-14.

## Contexte

Le planning existe : Équipe › Planning pour le propriétaire et un manager actif (semaine en grille par compte, une couleur par membre, créneaux, « à pourvoir », modèles de shift, congés et échanges, un jour à la fois sur téléphone), Mon planning pour le chatteur (ses seuls shifts), et Équipe › Membres (ajout, taux daté, statuts). En base, la politique `member_read` de `shifts` ne laisse à un chatteur que ses propres shifts, et l'ADR 0031 en fait une règle : l'échange est la seule porte vers le planning d'un autre.

Le 02/11, Charles a demandé (message de 16h36, réponses de 16h44 aux questions P1 à P11 de la lecture d'Imperium) :

- que **tout le monde voie le planning** : le chatteur, pour savoir « qui passe avant, qui passe après » et se coordonner ; la créatrice, pour les shifts de ses comptes ;
- une **vue Mois** en plus de la semaine, pas de carte annuelle ;
- un planning **pratique et intuitif** : déplacer un shift au doigt sur le téléphone, robuste, avec de belles animations ; ajouter un chatteur sur plusieurs jours et créneaux en une fois ; une suggestion de chatteur à l'ajout ;
- des **rappels par l'application elle-même**, pas par Telegram, que chacun règle pour lui ;
- un lien de calendrier pour ses propres shifts, pas d'export PDF ou CSV ;
- une fiche du chatteur complète, et **jamais d'effacement** d'un chatteur : un départ.

La lecture d'Imperium du 02/11 (hors dépôt, fonctions seulement) a montré un « planning général » de toute l'équipe pour le chatteur, une vue mois, le glisser-déposer, l'ajout en masse et une suggestion de chatteur, mais aussi des défauts : déplacer ou supprimer un shift ne prévenait pas le chatteur, l'ajout en masse et le déplacement ignoraient les congés, désactiver un chatteur laissait ses shifts futurs.

## Décision

### 1. Ce que chacun voit

- **Le propriétaire et un manager actif** : tout le planning, comme aujourd'hui, plus la charge de chaque membre (ses heures planifiées dans la semaine).
- **Un chatteur actif** voit le planning de **toute l'équipe**, en lecture, en semaine et en mois : pour chaque shift, le nom dans l'équipe du membre, sa couleur, la créatrice et le créneau. Rien d'autre : ni congé, ni taux, ni pays, ni statut, ni rapport, ni charge. Un collègue en congé n'a simplement pas de shift. Un membre suspendu ou absent garde son accès restreint (ADR 0023) et ne voit que ses propres shifts.
- **La créatrice** voit les shifts **de ses comptes**, en lecture, en semaine et en mois, avec le nom dans l'équipe du chatteur et le créneau, dans son Agenda (ADR 0042 § 4), en une couche qu'elle peut masquer. Rien des autres créatrices, rien de l'équipe au-delà.
- **En base** : ces lectures passent par une vue étroite (membre, nom dans l'équipe, couleur, créatrice, début, fin), lue sous `withMember` pour un membre actif et sous le chemin de la créatrice de l'ADR 0042 § 2 pour elle. La politique `member_read` de `shifts` et l'accès à `team_members` ne changent pas. Un test d'intégration RLS prouve chaque frontière : le chatteur ne lit ni congé ni taux d'un collègue, la créatrice ne lit que ses comptes, un membre restreint ne lit que les siens.

### 2. Les vues

- **Semaine** (celle d'aujourd'hui) et **Mois** pour tous : la grille du mois montre chaque jour ses shifts en pastilles de couleur ; toucher un jour l'ouvre en détail.
- **Sur téléphone**, un jour à la fois (déjà fait) et la liste de la semaine.
- Pas de vue annuelle : rien ne s'y décide.
- En tête, pour l'agence : les créneaux à pourvoir de la semaine, comptés. Sur le calendrier d'un chatteur et de l'agence : les éléments de l'agenda de la créatrice marqués « utile à l'équipe » (un live, un nouveau contenu, une absence ; ADR 0043 § 7).
- Les filtres (une créatrice, un membre) se gardent au retour, comme la semaine affichée.

### 3. Poser, déplacer, retirer

Réservé au propriétaire et à un manager actif. Chaque écriture passe par les mêmes contrôles du serveur qu'aujourd'hui (conflits, congé, premier jour du membre, verrou par membre de l'ADR 0031) et porte une clé d'idempotence.

- **Glisser-déposer** : à la souris sur ordinateur, par un **appui long puis le doigt** sur téléphone (retour haptique si l'appareil le permet). Pendant le geste, la case visée dit déjà si elle est libre ; au lâcher, le shift se pose avec le ressort du design system. Si le serveur refuse, le shift revient à sa place avec la raison, jamais en silence. Un déplacement s'annule pendant 5 secondes. Le défilement de la page et le geste ne se confondent pas : sans appui long, le doigt fait défiler. Le même déplacement existe au clavier et depuis la fiche du shift.
- Déplacer une occurrence d'un modèle de shift ne déplace que cette occurrence ; changer le modèle reste un geste à part.
- **Ajout en masse** : un membre, plusieurs jours et créneaux en une fois. Avant de valider, l'écran dit quelles cases sont prises ou tombent dans un congé ; elles ne sont jamais écrasées. La validation pose le reste en une transaction.
- **« Faire de cette semaine le modèle »** : les shifts de la semaine affichée deviennent les modèles de shift à partir de la semaine suivante, après un récapitulatif de ce qui s'ajoute et de ce qui s'arrête. Rien n'est rétroactif.
- **Suggestion de chatteur** à l'ajout, calculée par le code, sans IA : d'abord les membres actifs qui travaillent sur cette créatrice et l'ont le plus chattée sur 90 jours, puis les moins chargés de la semaine. Jamais un membre déjà sur un shift à cette heure, en congé ou hors de ses créatrices.

### 4. Prévenir

- Les rappels passent par les notifications de l'application installée (Web Push, EQ-12, ADR 0042 § 7), **jamais par Telegram**.
- Un membre est prévenu de chaque shift qui lui est posé, déplacé ou retiré ; un ajout en masse fait une seule notification qui résume. Il reçoit un rappel avant chacun de ses shifts, au délai qu'il choisit dans Moi (2 h par défaut, ou aucun).
- La créatrice choisit dans Moi si elle veut être prévenue des shifts de ses comptes ; par défaut, non.
- Chaque envoi passe par le registre d'EQ-12 (une seule fois par membre, objet et motif) et respecte les heures calmes de chacun.

### 5. Le calendrier dans le téléphone

- Chaque membre a un lien iCal secret, révocable, en lecture seule, de **ses propres shifts** ; la créatrice peut ajouter les shifts de ses comptes à son lien de l'ADR 0042 § 4. Le lien ne porte que le créneau, la créatrice et le nom dans l'équipe : jamais de donnée de fan ni de montant.
- Pas d'export PDF ni CSV du planning.

### 6. La fiche du chatteur et son départ

- « Modifier » gagne le nom, l'e-mail, le pays et le fuseau ; le rôle change à une date (un 1er ou un 16, jamais avant aujourd'hui), comme le taux ; la fiche montre l'historique des taux et des rôles. Pas de photo : initiales et couleur. Pas de statut « malade » ni « en déplacement » : ce sont des congés (ADR 0031).
- **Un membre n'est jamais effacé** : ses relevés et ses factures sont gardés dix ans (ADR 0037). Le parcours « Faire partir » (EQ-14) date sa fin, libère ses shifts d'après en « à pourvoir », arrête ses modèles, coupe ses sessions et demande de cocher « Accès Reveal retiré ». Il disparaît alors du planning à venir et des listes, et reste lisible dans l'historique.

### 7. Finition

- Chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran (hiérarchie, survols, animations, navigation fluide, design system seul), avec les captures Nuit et Jour, ordinateur et téléphone, mouvement réduit.
- Un prototype cliquable du calendrier (semaine, mois, glisser au doigt, ajout en masse) est validé par Charles avant le code.

## Ordre

Prototype validé → vue étroite et calendrier du chatteur et de la créatrice (Bilan pour la base, Équipe pour le module) → vue Mois, glisser-déposer, ajout en masse, semaine en modèle, suggestion (Équipe, écrans relus par Extension) → prévenir (EQ-12) → liens iCal → fiche et départ (EQ-14). Rien n'attend les clés ni la capture Reveal.

## Conséquences

Positives :
- Chacun sait qui chatte avant et après lui ; la créatrice sait qui la fait vivre, sans rien voir de l'équipe.
- Poser une semaine prend quelques gestes, et un chatteur n'apprend jamais un changement par hasard.
- Le départ d'un chatteur ne laisse ni shift fantôme ni accès ouvert.

Négatives, à surveiller :
- Les chatteurs voient les horaires de tous : c'est voulu ; la vue ne porte rien d'autre, et la base le garantit.
- Le glisser-déposer au doigt est délicat (défilement, petites cases, conflits en direct) : le prototype et les tests sur iPhone et Android le valident avant la fusion.
- La suggestion n'est qu'un ordre : elle ne pose rien seule.

## Alternatives rejetées

- **Le chatteur ne voit que les créatrices où il travaille** : moins utile pour se coordonner ; Charles veut toute l'équipe.
- **Une carte de chaleur annuelle, comme Imperium** : jolie, mais rien ne s'y décide.
- **Des rappels par Telegram** : Charles veut tout dans l'application installée (déjà EQ-12).
- **Exports PDF et CSV** : personne ne s'en servait pour décider ; le lien iCal met les shifts là où on les regarde.
- **Supprimer un chatteur** : la paie et les factures doivent rester dix ans.
