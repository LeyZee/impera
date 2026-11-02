# 0042. Espace de la créatrice : elle voit tout son compte, rien de l'équipe, et personne ne lui impose une tâche

Statut : proposed (cadrage avec Charles le 02/11/2026, fil « Concevoir les espaces modèle et chatteur mobiles » ; à accepter par Charles)
Date : 2026-11-02
Remplace :
- dans l'ADR 0023 § Rôles, la phrase « La `creator` voit sa routine, ses revenus, ses factures et qui est en poste, jamais une conversation ni un fan » ;
- dans l'ADR 0024 § Le rail dépend du rôle, la ligne « Créatrice » du tableau ;
- dans l'ADR 0030 § 3, les mots « `validated_by` qui référence un membre de l'agence (`team_members.id`, jamais un texte libre) ».
Les ADR 0023, 0024 et 0030 restent telles quelles ; l'index des ADR renvoie d'elles à celle-ci. La fiche EQ-09 sera réécrite d'après cette ADR une fois acceptée.

## Contexte

L'ADR 0023 a prévu une PWA de la créatrice (fiche EQ-09, phase 5) : sa routine, ses revenus, ses factures, qui chatte pour elle. Rien n'en est codé. Le 02/11, Charles a demandé que cet espace arrive vite, et l'a précisé question par question (document de cadrage du 02/11, 41 questions) :

- c'est l'espace de la **collaboration** entre l'agence et la créatrice : ce qu'elle doit tourner, ce qui se vend, ce qu'elle gagne ;
- elle a un **droit de regard** sur tout ce qui se fait sur son compte, fans et conversations compris (« c'est sur son compte qu'on travaille ») ; elle ne voit jamais rien de l'équipe : ni taux, ni paie d'un chatteur ;
- **personne ne lui impose rien** : l'IA et l'agence proposent, elle accepte ou non ; on n'empiète jamais sur sa vie personnelle, elle ouvre des créneaux pour l'agence ;
- un **vrai agenda**, propre à Nirvana, sur les usages des applications d'agenda existantes ;
- chaque dimanche, un **topo intelligent** de la semaine et une to-do qui vise ce qui rapporte le plus sur Reveal, que Charles relit et corrige avant qu'elle parte ; on ne lui propose que ce qui a de bonnes chances de marcher, jamais une liste de ce qui n'a pas marché ;
- ses **gains** au jour le jour, détaillés comme dans Imperium jusqu'à « ce qui part à toi » ;
- sur Reveal, **pas de facture** entre l'agence et la créatrice : Reveal reverse lui-même à chacune ;
- tout doit être parfait sur téléphone, installé sur l'écran d'accueil.

La lecture fonctionnelle d'Imperium du 02/11 (hors dépôt) a donné la chaîne de calcul des revenus et les écrans qui servaient vraiment (parcours de l'argent, routine à deux couches, qui est en poste, heures calmes et plafond de notifications), et quelques pièges : taux de change du jour appliqué aux quinzaines passées, part d'agence absente remplacée en silence par 35 %, accueil en brut par semaine et revenus en net par quinzaine sans lien visible, une notification de vente perdue pendant les heures calmes.

## Décision

### 1. Accès

- Le propriétaire invite la créatrice par un lien à usage unique, valable 72 h. Elle crée son mot de passe puis une clé d'accès (Face ID, empreinte) sur son téléphone. Son compte (rôle `creator`, déjà prévu) est lié à sa fiche créatrice et, par elle, à ses comptes plateforme.
- Plusieurs créatrices dès la première version : tout est déjà borné par `creator_id`. Une créatrice ne voit que la sienne.

### 2. Ce qu'elle voit, ce qu'elle ne voit jamais

- **Elle voit tout son compte**, en lecture : ses ventes avec le fan qui a acheté, ses fans (pseudo, dépenses, notes), les conversations de ses comptes, ses médias et leurs descriptions, les publications prévues et passées, qui est en poste sur elle (nom affiché et créneau).
- **Elle ne voit jamais l'équipe** : ni `team_members` (taux, pays, statut, dossier), ni relevé, facture, avoir ou versement d'un prestataire, ni les retours de l'IA à un chatteur (ADR 0043). Un chatteur n'apparaît chez elle que par son nom affiché, par la vue déjà prévue par l'ADR 0023.
- **Elle n'écrit jamais à un fan depuis Nirvana** : les conversations sont en lecture seule pour elle.
- La base dit la même chose que l'écran : les tables de l'équipe et de la paie restent fermées au rôle `creator` (scope `self` sans ligne de membre), et un test d'intégration RLS le prouve.
- **Droit de regard, jamais obligation** : elle peut corriger la description d'un de ses médias et la légende d'une de ses publications, ou retirer une publication prévue. Aucun traitement n'attend son geste. Une validation de description (ADR 0030 § 3) porte désormais l'utilisateur qui valide, membre de l'agence ou créatrice du média, référencé par son identifiant de compte, jamais un texte libre.

### 3. Personne ne lui impose rien

- Ce que l'agence ou l'IA veut voir dans son agenda est une **suggestion** : elle l'accepte (telle quelle ou déplacée) ou la refuse, d'un geste, avec un motif facultatif. Seule une suggestion acceptée entre dans son agenda.
- La routine d'EQ-09 suit la même règle : une tâche de routine de l'agence est proposée, et une fois acceptée elle est à elle. La série et la « journée réussie » d'Imperium sont reprises (journée réussie = toutes les essentielles acceptées faites, un joker, paliers 7, 14, 30, 50, 100 ; journée parfaite = toutes les quotidiennes), calculées par le serveur dans **son** fuseau.
- L'agence voit, sans rien pouvoir forcer, ce qui est proposé, accepté, refusé et fait : c'est son assurance que le travail avance.

### 4. L'agenda

- Propre à Nirvana, sans synchronisation dans les deux sens. Un lien d'abonnement iCal en lecture seule, secret et révocable, montre ses éléments Nirvana dans son agenda habituel (Apple, Google).
- Trois sortes d'éléments : **créneau** (début et fin : tournage, live, rendez-vous), **tâche** (un jour, sans heure, à cocher), **routine**. Une couleur sobre par catégorie, dont une catégorie « Réseaux », remplie à la main tant que le chantier 6 n'existe pas.
- Vues : Jour et « Ma semaine » sur téléphone ; Semaine et Mois en plus sur ordinateur. Les gestes sont ceux des agendas connus : appui long ou glisser pour créer, glisser pour déplacer, balayer pour changer de jour.
- **Disponibilités** : elle déclare les créneaux qu'elle ouvre à l'agence (récurrents ou ponctuels). Les suggestions datées ne tombent que dans ces créneaux, jamais sur un élément existant ; sans créneau ouvert, une suggestion reste sans date dans « Ma semaine ».
- Une tâche de contenu est une **fiche de tournage** : pour quoi (feed, Mass DM, script), quoi (photos ou vidéo, combien, durée), ambiance, Jour ou Nuit, et un exemple d'un contenu qui a marché. Les dégoûts de la persona sont filtrés par le code avant toute suggestion (règle 3 de `CLAUDE.md`).
- Ses rappels sont les siens : elle choisit s'il y en a, et quand.

### 5. Le topo de la semaine

- Un job (`creator.weekly_brief`, rejouable, un par créatrice et par semaine) tourne le dimanche à 18 h dans son fuseau.
- **Le code calcule les faits** : stock du dossier de contenu par usage (ADR 0044), publications déjà planifiées, résultats des publications de la semaine, ventes par contenu, remontées des chatteurs (ADR 0043), suggestions encore ouvertes, ses disponibilités. **Le modèle de langage ne fait que rédiger** le topo et les suggestions de tâches à partir de ces seuls faits, par la passerelle LLM, avec un schéma de sortie Zod ; un chiffre qu'il écrirait sans l'avoir reçu est refusé. On ne propose que ce qui a marché ou a de bonnes chances de marcher ; aucune section « à éviter ».
- Le propriétaire (ou un manager actif) relit la semaine dans un écran fait pour ça : chaque suggestion se modifie, se déplace ou se retire sur place. La semaine part à la créatrice à sa validation, ou le lundi à 8 h dans son fuseau si personne n'y a touché. Un réglage par créatrice rend la validation obligatoire.
- Elle reçoit le lundi matin une seule carte : ses gains de la semaine, ce qui a marché, ses suggestions.
- Le coût passe par le plafond de dépense IA existant. Un agent externe par le MCP (ADR 0026) pourra plus tard proposer, jamais valider.

### 6. Ses gains

- La chaîne d'Imperium, à l'identique (règle de l'ADR 0023), **par compte plateforme et par période** : brut payé par les fans (TTC, en euros) → hors TVA = brut ÷ (1 + TVA) → net = hors TVA × (1 − commission de la plateforme) → part de l'agence = net × pourcentage de la créatrice → **sa part = net − part de l'agence**.
- Calculée par le serveur, en entiers (ADR 0011), arrondie au centime après chaque étape, demi qui s'éloigne de zéro, comme la paie. Le taux de change est celui du jour de la vente (ADR 0033), jamais celui du jour de la lecture.
- La TVA et la commission viennent des paramètres de la plateforme déjà prévus par l'ADR 0023. Le **pourcentage de l'agence** est un réglage par créatrice, saisi dans le CRM par le propriétaire, daté et jamais appliqué en arrière. Sans pourcentage réglé, l'écran dit « à régler » et ne montre aucune part : jamais de valeur par défaut silencieuse.
- La source des ventes est celle de la paie pour ce compte (ADR 0023, ADR 0043) : les ventes saisies par les chatteurs, puis les ventes détectées. Tant que la période n'est pas close, les montants sont marqués « estimés ».
- L'écran montre « Ta part » en grand, puis le parcours ligne par ligne (fans, TVA, plateforme, agence, toi), sur Aujourd'hui, la quinzaine et le mois, avec l'écart au mois précédent à la même date et un objectif du mois facultatif fixé avec l'agence. Une seule unité de période par écran.
- **Pas de facture** entre l'agence et la créatrice pour Reveal. Une facturation (OnlyFans) demandera sa propre ADR.

### 7. Notifications

- Web Push (clés VAPID en configuration, jamais dans le dépôt), abonnement par appareil, préférences par compte.
- **Une notification par vente**, regroupées seulement en rafale (plus de 3 en 2 minutes). Heures calmes réglables par elle (22 h – 8 h par défaut) : rien ne sonne, et un récapitulatif l'attend à la fin des heures calmes. Un plafond quotidien pour tout le reste (rappels, routine, série), hors ventes.

### 8. Une seule application installable, et la barre de la créatrice

- Une seule PWA pour tous les rôles : même adresse, même icône, l'écran dépend du rôle (ADR 0024). Manifeste et service worker dans `apps/web` ; l'enveloppe, l'agenda et la routine se consultent et se cochent hors ligne, et se synchronisent au retour ; ventes et argent en ligne seulement. Guide d'installation à part pour iPhone (les notifications exigent l'installation) et Android.
- La barre de la créatrice devient : **Aujourd'hui · Agenda · Ventes · Contenu · Moi**. Aujourd'hui porte sa journée, qui chatte pour elle et les dernières ventes ; Ventes porte ses gains, ses ventes et ses fans (une conversation s'ouvre depuis un fan) ; Contenu porte ses dépôts et ses publications (ADR 0044) ; Moi porte son profil, ses notifications et son lien iCal.
- Vérifié sur un iPhone (Safari) et un Android d'entrée de gamme (Chrome), Nuit et Jour, mouvement réduit, avec la barre de finition de `docs/design/README.md`.

## Ordre

Cette ADR, l'ADR 0043 et l'ADR 0044 → socle PWA (manifeste, service worker, notifications, clés d'accès ; passe téléphone sur les écrans du chatteur) → accès de la créatrice et ouverture de ses lectures → ventes saisies et rapport (ADR 0043) → gains et ventes de la créatrice → agenda, routine, suggestions et disponibilités → dépôt de contenu (ADR 0044) → topo de la semaine (clé xAI) → publication du feed, contrôle par les ventes de Reveal, retours de l'IA, Mass DM (capture Reveal). Les cinq premiers lots n'attendent ni les clés ni la capture.

## Conséquences

Positives :
- La créatrice a un outil qu'elle peut ouvrir chaque jour sans rien devoir à l'agence, et l'agence voit ce qui avance.
- La transparence sur son compte est complète, et la paie de l'équipe reste privée par la base, pas seulement par l'écran.
- Les gains se recalculent au centime et ne dépendent plus de la date de lecture.

Négatives, à surveiller :
- Ouvrir conversations et fans au rôle `creator` élargit ce qu'un compte volé expose : clé d'accès, double authentification proposée, sessions révocables, et chaque ouverture de conversation par la créatrice au journal, comme pour un chatteur.
- Une suggestion refusée sans motif ne dit rien à l'agence : le topo suivant en tient compte (on ne repropose pas une tâche refusée la semaine d'avant).
- Les clés d'accès demandent peut-être une dépendance (Better Auth) : quarantaine de 14 jours et relecture du propriétaire de l'authentification.

## Alternatives rejetées

- **Synchroniser Google Agenda et Apple Agenda dans les deux sens** : comptes tiers, conflits, autorisations, pour un gain faible ; le lien iCal en lecture suffit à tout voir au même endroit.
- **Des tâches de l'agence non supprimables** (fiche EQ-09, Imperium) : contraire à la règle de Charles, personne ne lui impose rien.
- **Laisser le modèle de langage choisir les quantités** (combien de contenus, combien de publications) : règle 3 de `CLAUDE.md`, les chiffres sont au code.
- **Deux applications** (créatrice, chatteur) : deux installations, deux mises à jour, pour rien.
- **Une messagerie agence ↔ créatrice** : WhatsApp et Discord font déjà ce travail (Charles, 02/11).
