# ADR : décisions d'architecture

Une ADR (Architecture Decision Record) fige une décision structurante avec son contexte, pour qu'une session future ne la rouvre pas sans savoir pourquoi elle a été prise.

## Règles

- Une ADR est **immuable** une fois `accepted`. Pour changer d'avis : nouvelle ADR qui `supersedes` l'ancienne (l'ancienne passe en `superseded`).
- Statuts : `proposed` (une session Opus peut en créer une) → `accepted` (Charles ou la session d'architecture) → `superseded` / `rejected`.
- Numérotation séquentielle à 4 chiffres, nom `NNNN-slug.md`.
- Une session de code qui prend une décision structurante non couverte **doit** créer une ADR `proposed` et le dire dans sa fiche de tâche. Elle ne doit pas passer outre une ADR `accepted`.

## Gabarit

```
# NNNN. Titre
Statut : proposed | accepted | superseded by NNNN | rejected
Date : AAAA-MM-JJ
## Contexte
## Décision
## Conséquences (positives, négatives, à surveiller)
## Alternatives rejetées
```

## Index

| N° | Titre | Statut |
|---|---|---|
| 0001 | TypeScript, monorepo pnpm + Turborepo | accepted |
| 0002 | Monolithe modulaire, frontières vérifiées par ESLint | accepted |
| 0003 | Cœur agnostique de la plateforme (y compris notre future plateforme sans abonnement) | accepted |
| 0004 | Fastify plutôt que NestJS | accepted |
| 0005 | Postgres + Drizzle + RLS par `creator_id` | accepted ; la base de production remplacé par 0152 |
| 0006 | Graphile Worker, une file série par conversation | accepted |
| 0007 | Journal d'événements de conversation comme source de vérité | accepted |
| 0008 | Port `PlatformConnector` ; Reveal via session capturée et client API serveur | accepted (complétée par 0050 : l'API CRM pour les ventes et les chiffres ; B confirmée par P1-03 le 11/11, `reveal-connector-spec.md` § 1) |
| 0009 | Passerelle LLM unique, trois rôles, règles métier dans le code | accepted |
| 0010 | Persona = donnée versionnée (YAML + schéma Zod), pas du code | accepted |
| 0011 | Argent en unités mineures entières ; identifiants UUID v7 typés | accepted |
| 0012 | `identity_policy` configurable, défaut `stay_in_character` | superseded (0021) |
| 0013 | Code en anglais, documentation, UI et persona en français | accepted |
| 0014 | Politique d'hygiène du dépôt | accepted |
| 0015 | Design system partagé dans `packages/design-system` | accepted |
| 0016 | Clés des fournisseurs IA saisies dans le dashboard, chiffrées en base | accepted |
| 0017 | Vision : Gemini en natif, bascule sur Grok en images clés | accepted |
| 0018 | Port connecteur étendu : scripts natifs, notes, coffre, médias, garde d'écriture | accepted (l'alternative « un second port » remplacée par 0050 pour les ventes et les chiffres) |
| 0019 | Deux taux (au playground, en réel) et la règle qui ouvre le mode Automatique | accepted |
| 0020 | Notifications Telegram : bots, groupes et routage gérés depuis le CRM | proposed |
| 0021 | Rester en personnage est fixé dans le code, sans réglage | accepted |
| 0022 | La persona fait partie de la version qui ouvre l'Automatique | accepted |
| 0023 | La gestion d'équipe entre dans Nirvana : planning, rapports, paie, routine des créatrices | accepted (§ Navigation remplacé par 0024, gardes du chatteur par 0025, congés par 0031, attestation de résidence par 0041, rôle de la créatrice par 0042) |
| 0024 | Rôles et navigation : chacun ne voit que ce qui le concerne | accepted (Suivi du chatteur remplacé par 0025, ligne Créatrice du rail par 0042) |
| 0025 | Le chatteur chatte dans Reveal ; dans Nirvana, il traite sa créatrice pendant son shift, et rien hors shift | accepted |
| 0026 | Serveur MCP de Nirvana : une seconde porte sur les mêmes commandes | accepted (§ 5 « freiner, jamais accélérer » amendé par 0058 pour la seule publication du contenu public ; amendé par 0105) |
| 0027 | Mise en production : deux images, un compose Coolify, un limiteur partagé en Postgres | accepted ; le lieu (VPS Hetzner) remplacé par 0152 |
| 0028 | Export quotidien chiffré de la base, hors de Neon | accepted (§ 1 outils et § 2 `--no-privileges` remplacés par 0029) |
| 0029 | L'export garde les droits de la base, et s'outille sans binaire hors d'Alpine | accepted |
| 0030 | Médiathèque : un média, ses liaisons par plateforme, le coffre fait foi | accepted (§ 3 `validated_by` remplacé par 0042 ; § 2 et § 4 remplacés par 0044 pour le contenu déposé et par 0056 pour les scripts déposés) |
| 0031 | Congés et échanges de shift : le congé appartient au membre, l'échange se fait entre chatteurs | accepted (remplace en partie 0023 : congés ; « la seule porte » vers le planning d'un autre remplacée par 0045) |
| 0032 | Paie : la quinzaine se clôture pour toute l'équipe à sa première validation | accepted (complète 0023 § Paie) |
| 0033 | Paie : le taux dollar → euro vient de la BCE, lu chaque heure par un job | accepted (complète 0023 § Paie et 0032) |
| 0034 | Le test à l'aveugle est une séance : le serveur calcule le taux, à partir de 40 situations | accepted (complète 0019 ; exception à 0023 à valider) |
| 0035 | Paie : une saisie verrouille sa quinzaine et chacune des suivantes | accepted (complète 0032 § Verrous) |
| 0036 | Factures : ce qu'une quinzaine doit rendre devient un avoir sur une facture déjà émise | accepted (précise 0023 § Factures) |
| 0037 | Factures : un PDF/A rendu une fois par PDFKit, gardé dix ans sous verrou de conformité, en deux copies | accepted (précise 0023 § Factures et 0028 § 4) |
| 0038 | Paie : un petit montant est reporté deux fois au plus, pour que chaque facture soit payée avant son échéance | accepted (remplace dans 0023 le report sans limite d'un montant positif) |
| 0039 | Factures : une contestation fondée se corrige par la paie, jamais par un avoir écrit à la main | accepted (remplace dans 0036 la phrase sur l'état « créditée » ; précise 0023 § Factures ; au § 3, la ligne refacturée sur la facture du jour et sa conséquence sur le régime remplacées par 0040) |
| 0040 | Factures : « annuler et refacturer » émet une facture rectificative, sous le régime de la facture annulée | accepted (remplace dans 0039 § 3 la ligne refacturée sur la facture du jour) |
| 0041 | Factures : l'attestation de résidence fiscale conditionne le versement, pas la facture | accepted (remplace dans 0023 § Factures la phrase sur l'attestation, et les choix (a) et « ok année civile » du lot 5c) |
| 0042 | Espace de la créatrice : elle voit tout son compte, rien de l'équipe, et personne ne lui impose une tâche | accepted (remplace dans 0023 la phrase de § Rôles sur la créatrice, dans 0024 sa ligne du rail, dans 0030 § 3 la référence de `validated_by` ; au § 6 la phrase sur la source des ventes remplacée par 0054 ; au § 2 la phrase « Elle voit tout son compte » remplacée par 0063, la phrase sur l'auteur d'un message par 0065 ; § 4 précisé par 0082 : fiche reel) |
| 0043 | Chatteur : ventes saisies une à une, rapport de fin de shift contrôlé par le code, retours de l'IA sans effet sur la paie | accepted (précise 0023 et EQ-03 ; au § 4 la vente sans attribution et au § 5 le rapport d'un compte détecté remplacés par 0050) |
| 0044 | Feed et Mass DM : la créatrice dépose son contenu dans Nirvana, l'agent le téléverse et le planifie à la semaine | accepted (remplace 0030 § 2 et § 4 pour le seul contenu déposé ; § 1 usage et § 2 départ des 30 jours remplacés par 0055) |
| 0045 | Calendrier des shifts : toute l'équipe et la créatrice voient qui chatte quand, l'agence pose et déplace au doigt | accepted (remplace dans 0031 la phrase « la seule porte ») |
| 0046 | Accès au dashboard : deuxième facteur, connexions bornées, alertes de sécurité | accepted (remplace security.md § 1 sur l'exposition du dashboard ; précisée par 0053 : une clé d'accès vaut mot de passe et code) |
| 0047 | Ranger le code qui a grossi : la paie en quatre modules, l'argent calculé par le seul serveur, l'assemblage par module, le dashboard par domaine | accepted (précise 0002) |
| 0048 | L'IA dans le calendrier des shifts : ses heures se lisent à côté de celles des chatteurs | accepted (précise 0045) |
| 0049 | Créneaux libres, plusieurs chatteurs sur un compte, fans confiés ; la créatrice sans notification de shift | accepted (remplace le réglage de créneaux d'EQ-02, la contrainte d'un membre par compte et 0045 § 4 pour la créatrice) |
| 0050 | Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste | accepted (complète 0008 ; remplace dans 0018 l'alternative « un second port » pour les ventes et les chiffres, dans 0043 § 4 la vente sans attribution et § 5 le rapport d'un compte détecté ; précise 0023, dont le calcul des montants par plateforme, 0025, 0049 ; § 8, part de la créatrice, précisé par 0054 ; § 8, frontière de la bascule, amendé par 0084) |
| 0051 | Un second point d'entrée, pur, pour les règles qu'un module prête aux domaines qui en dépendent | accepted (précise 0002 pour l'ADR 0047 § 1) |
| 0052 | Le chatteur sous l'œil de la persona : chaque message qu'il écrit dans Reveal est relu, chaque écart lui est signalé, rien n'est bloqué ni retenu sur sa paie | accepted (précise 0025 et 0043 § 6 ; au § 5 la phrase sur Telegram remplacée par 0059) |
| 0053 | Clé d'accès (Face ID, empreinte) : un geste vaut mot de passe et code | accepted (précise 0046 § 1, 3, 5 à 8) |
| 0054 | Gains de la créatrice : les chiffres de Reveal dès que son modèle est relié, sans attendre la bascule | accepted (remplace dans 0042 § 6 la phrase sur la source des ventes ; précise 0042 § 6 et 0050 § 8 ; amendée § 4 à § 8 le 14/11 : part de l'agence lue chez Reveal, pourcentage facultatif) |
| 0055 | Dépôt de contenu : la créatrice range chaque dépôt dans sa catégorie, l'agence lui demande ce qui manque | accepted (remplace dans 0044 § 1 l'usage à deux valeurs, et § 2 le départ des 30 jours) |
| 0056 | Scripts : l'agence écrit ses structures, la créatrice tourne carton par carton, Nirvana range dans l'ordre et téléverse | accepted (remplace 0030 § 2 et § 4 pour les scripts déposés ; § 3, phrase sur la palette, remplacée par 0064) |
| 0057 | Instagram et Telegram : deux connecteurs de publication, par les API officielles, dans le même plan que le feed | accepted (§ 6 et § 7 précisés par 0082 : fenêtre visible d'une légende, aperçu ; § 2 amendé par 0120 : branchement en deux temps, lecture d'abord) |
| 0058 | Un agent externe peut préparer et publier le contenu public de la créatrice, et seulement lui | accepted (amende 0026 § 5 pour la seule publication) |
| 0059 | Écarts de persona sur Telegram : les interdits graves tout de suite, les autres au bilan du soir, jamais un nom | accepted (remplace dans 0052 § 5 la phrase sur Telegram ; précise 0020) |
| 0060 | Veille et idées de contenu : signaux de sources propres, capture passive par l'extension, idées filtrées par le code et validées par l'agence | accepted (§ 2, « la moyenne de son compte », remplacée par la médiane de 0082 ; § 4 et § 5 précisés par 0082 : écart, fiche reel ; § 2 amendé par 0120 : la lecture des statistiques n'attend plus la publication) |
| 0062 | Le projet s'appelle Impera : un renommage mécanique, en une PR, dans une fenêtre de gel | accepted |
| 0063 | La créatrice ne lit aucune note de ses fans, seulement des chiffres sur l'ensemble de sa base | accepted (remplace dans 0042 § 2 la phrase « Elle voit tout son compte » ; § 3 en partie remplacé et § 2 précisé par 0065) |
| 0064 | Cartons de script : la couleur du script et le dessin d'OnlyScript | accepted (remplace dans 0056 § 3 la phrase sur la palette) |
| 0065 | La créatrice voit qui a écrit chaque message, et des chiffres sur ses fans | accepted (remplace dans 0042 § 2 la phrase sur l'auteur d'un message, dans 0063 § 3 « sans jamais voir qui a écrit un message » ; précise 0063 § 2) ; nombre au survol du § 2 remplacé par 0074 |
| 0066 | Le popup de l'extension : la connexion est celle du CRM, l'extension ne garde aucun secret de connexion | accepted (précise 0008 et 0062 § 8) |
| 0067 | L'équipe installe l'extension depuis le CRM, puis depuis le Chrome Web Store en « non répertoriée » | accepted (précise 0066 et 0027) |
| 0068 | Mot de passe oublié du propriétaire (Telegram, puis e-mail) et QR code de la validation en deux étapes | accepted (précise 0016, 0020 et 0046) |
| 0069 | Les créatrices s'importent depuis Reveal par une revue du propriétaire, jamais en silence | accepted (précise 0050 § 3 et 0054) |
| 0070 | Une vidéo déposée pèse jusqu'à 10 Go et vient dans tout format courant ; ce que les plateformes ne lisent pas est converti en MP4 | accepted (précise 0055 § 2 et § 3) |
| 0071 | Une créatrice se renomme et s'archive, sans rien supprimer, et l'e-mail d'un accès pas encore utilisé se corrige | accepted (précise 0042 § 1 et 0069 § 5) |
| 0072 | Paie : le relevé final d'un membre parti est celui de la quinzaine de son départ, et son solde négatif s'éteint | accepted (amende 0039 § 6, précise 0038 et 0023) |
| 0073 | Rapport déclaré sur Reveal : l'écart avec les ventes lues se voit, s'explique et se tranche par un humain | accepted (remplace dans 0043 § 4 le contrôle d'un compte Reveal en « déclaré », précise 0023, 0050 et 0018) |
| 0074 | Les chiffres de sa base : quels faits comptent, et comment âge, lieu, métier et situation se rangent en cases | accepted (précise 0063 § 2 et 0065 § 3 et § 4 ; remplace dans 0065 § 2 le nombre au survol) |
| 0075 | Bac à sable de recette : Reveal et IA simulés, jamais actifs hors développement | accepted (précise 0008, 0009, 0016, 0050, 0027) |
| 0076 | L'équipe s'importe depuis Reveal par des suggestions confirmées, jamais en silence | accepted (précise 0050 § 5, 0023, 0024 § Rôles et 0069) |
| 0077 | Rapport de fin de shift : Impera le rappelle au chatteur sur son téléphone | accepted (précise 0042 § 7, 0023 et 0073 § 5) |
| 0078 | Le Dashboard de l'agence lit ses insights dans le registre des ventes, pour le propriétaire et un manager actif | accepted (précise 0050 et 0043 § 7) |
| 0079 | La fiche persona reprend la fiche Desirali, onglet par onglet et question par question | accepted (précise 0010 ; remplace pour toute nouvelle version les blocs P5-01, `additional_info` et les listes fermées) |
| 0080 | Canal Telegram de la créatrice : les posts partent seuls à leurs créneaux, montrés une heure avant, avec un lien de redirection réglé dans le CRM | accepted (précise 0057, 0055, 0020 ; remplace pour le canal Telegram l'acceptation de 0057 § 3 et l'adresse de 0057 § 6) |
| 0081 | Les abonnés, les PPV envoyés et les messages se gardent en photo quotidienne lue chez la plateforme | accepted (précise 0078 § 6 et 0050) |
| 0082 | Veille et Instagram : la médiane du compte, ce que le fil montre avant « … plus », la fiche reel | accepted (remplace dans 0060 § 2 « la moyenne de son compte » par la médiane ; précise 0060 § 4 et § 5, 0057 § 6 et § 7, 0042 § 4) |
| 0083 | Chaque média que la créatrice dépose est décrit en détail, seul, et validé avant tout usage | accepted (précise 0030 § 3 et 0056 § 6) |
| 0084 | La quinzaine vérifiée peut être la première payée sur les ventes Reveal | accepted (amende 0050 § 8 et la règle de départ des règles de paie d'EQ-03) |
| 0085 | La fiche du fan : vingt cases fermées que l'IA remplit en lisant la conversation, et que le chatteur corrige | accepted (précise P3-02, 0018 § 1 et 0063) |
| 0086 | Le panneau copilote : à côté de la conversation Reveal, la fiche du fan d'abord, le brouillon de l'agent ensuite, et c'est le chatteur qui envoie | accepted (précise 0025, 0019, 0066 § 7 et 0085) |
| 0087 | Un rôle de service entre le rôle applicatif et le rôle propriétaire de la base | accepted (précise 0005 et 0027) |
| 0088 | Fan en détresse : l'agent lui répond en mode soin, ventes gelées dans le code, et un humain valide chaque réponse | accepted (amende le filet AGT-01 et `protectionFor` ; précise 0021, 0019, 0085 § 9 et 0020) |
| 0089 | Les vignettes d'une créatrice archivée sont effacées 90 jours après son archivage | accepted (amende 0071 § 2 pour les vignettes ; précise 0030 § 4 et 0044 § 2) |
| 0090 | Une demande sur mesure passe à un chatteur qui prend la commande ; une objection de prix reçoit une réplique de la banque de l'agence | accepted (amende 0079 § 4 et § 6 ; précise P4-01 et 0023) ; § A points 1 et 2 remplacés par 0159 |
| 0091 | La consommation IA dans le CRM : la dépense lue dans `llm_calls`, les crédits prépayés décomptés depuis la saisie des recharges | accepted (précise 0016 et le plafond du jour) |
| 0092 | Piloter l'agence : la valeur de chaque chatteur, ce qui a changé chez une créatrice, les fans qui comptent | accepted (précise 0078, 0081, 0024 et 0043 § 7 ; amende 0078 « jamais nommé ici » et 0024 pour Entraîner) |
| 0096 | Un compte propriétaire de secours : deux propriétaires au plus, un retrait après 72 h de préavis que le visé peut annuler | accepted (précise 0024, 0046 et 0068) |
| 0098 | Le déroulé d'un script se tient fan par fan : le code choisit l'étape et le prix, la voix ne fait que les dire | accepted (précise P6-01, P6-02, 0018 § 5, 0056, 0064 et la politique d'offre) |
| 0099 | Synchroniser le coffre Reveal et bâtir des scripts avec ses médias, sans rien téléverser | accepted (précise 0030, 0018, 0083 et P6-01) |
| 0100 | Une IA écrit les scripts à partir des médias du coffre, le code tient la vente | accepted (précise 0099, 0083, 0009, 0010, 0021) |
| 0101 | Une vente donnée, entière ou partagée, au chatteur qui a été décisif | accepted (amende 0050 § 5 ; précise 0025, 0043 § 7 et 0092 § 1) |
| 0102 | Les réponses corrigées au playground deviennent la banque d'exemples de la créatrice, lue aussi par la prod | accepted (précise 0019 et 0022 ; dépend de 0103) |
| 0103 | Le playground en base : conversations, notes, cas rejouables, taux par version, calibrage du désir | accepted (précise 0019 et 0022) |
| 0104 | Le chatteur voit ses propres chiffres, et un jeu fait de faits réels l'accompagne | accepted (précise 0043 § 7, 0050 § 10 et 0092 § 1) |
| 0105 | Le MCP d'Impera remis à jour : un agent connecté lit, freine et prépare, un humain confirme | accepted (amende 0026 § 2 à § 5, § 7 et § 9) |
| 0106 | Le Dashboard de l'agence sépare chiffre d'affaires, net, part de la créatrice et part de l'agence, et estime la TVA des virements | accepted (précise 0078 et 0054 § 2) |
| 0107 | La créatrice gagne des médailles de série et des trophées pour ce qu'elle fait pour l'agence | accepted (précise 0042 § 3 et § 7, 0055 § 4 et § 6, 0044 § 4 ; reprend les limites de 0104 § B) |
| 0108 | Une vitrine des trophées commune au chatteur et à la créatrice : tout ce qui est gagné, ce qui reste, l'avancement vers le prochain | accepted (précise 0104 § B et 0107 § C) |
| 0109 | L'extension d'un chatteur écrit une case de la fiche du fan pendant son shift, et rien d'autre | accepted (précise 0066 § 7, 0086 § 8, 0085 et 0025) |
| 0110 | L'agent tient compte des automatisations de Reveal | accepted (remplace la ligne « sans effet sur le bot » de l'inventaire du connecteur ; précise 0006, 0018, P3-10) |
| 0111 | Le jeu des cœurs : le code juge la réponse, l'agent joue, la récompense part une fois | accepted (précise 0021, 0030, 0099, 0090 § 8, 0098, 0103 et 0110) |
| 0112 | Scripts à branches : les étapes et les branches de la plateforme, le code choisit la branche, la voix la dit | accepted (précise 0098 §§ 6 et 8, 0099, 0100 et 0103) ; amendement du 19/11 (créer un script à l’écran, le recopier dans Reveal) accepted, précise 0149 |
| 0113 | Les fichiers du coffre : lus le temps de la description, jamais gardés | accepted (précise 0018, 0030 § 3 et § 4, 0099 § 4, § 5 et § 7) |
| 0117 | L'agent écrit le prénom du membre et le canevas de la note client | accepted (précise 0018 § 1 et 0085 § 11) |
| 0118 | Les rapports validés nourrissent le jeu du chatteur, et un gain que le net corrigé ne justifie plus est repris | accepted (précise 0104 § 12 à § 16 et 0108 ; amende 0104 § 15 et § 16) |
| 0120 | Lire avant de publier : les statistiques du compte Instagram et les clics des liens de redirection, le retour sur un Reel, l'entonnoir d'acquisition | accepted (précise 0057, 0060, 0080, 0082, 0042 ; amende 0057 § 2 et 0060 § 2) |
| 0121 | « Mes liens » chez la créatrice, et le pilotage du trafic côté agence : paliers réglables, entonnoir par endroit, récap du jour | accepted (précise 0120, 0080 § 4, 0042) |
| 0122 | Les commentaires Instagram : une réponse courte dans sa voix, seule après un entraînement validé, et les commentaires hostiles masqués | accepted (précise 0057 §§ 1 et 6, 0120, 0102, 0021) |
| 0124 | Tous les fans d'une créatrice, listés pour l'agence | accepted (précise 0092 § 3, 0078, 0024, 0025, 0043 § 7, 0063) |
| 0126 | Les lives de la créatrice : l'agent se tait pendant, en parle après, et se relaie avec les chatteurs | accepted (précise 0042, 0048 § 4, P3-14, 0088) |
| 0128 | Ménager les scripts : une pause après un achat, un script rejoué par une autre variante du teasing, l'IA qui réclame des scripts | accepted (précise 0098 §§ 1, 6, 9 et 12, 0112 §§ 5, 11 et 15, 0103 et 0056) |
| 0129 | Mesurer les scripts de vente : l'entonnoir par étape, le revenu par fan exposé, ce qui casse et pourquoi | accepted (précise 0112 § 19, 0098 §§ 2 et 16, 0128 § 14 et 0103) |
| 0131 | Choisir le script qui colle aux goûts du fan : familles de fantasme, goûts des scripts et de la fiche, le code classe et l'IA choisit | accepted (précise 0098 § 6, 0056 § 6, 0085 et 0112 § 5) |
| 0132 | Paliers de dépense : l'IA plus proche et plus attentive avec les gros dépensiers, jamais plus pressante ; prix plus haut par branche de palier | accepted (précise 0085, 0086, 0088, 0128, 0131 ; amende 0112 § 2) |
| 0133 | L'agent pose une réaction sur un message du fan, en plus de sa réponse, quand le message la justifie | accepted (précise 0018, 0019, 0021, 0086, 0088, 0079) |
| 0134 | Navigation du CRM : une section Scripts, un sélecteur de créatrice, une fiche créatrice en quatre onglets, des icônes qui disent l'onglet | accepted (précise 0024, 0042 § 8, 0066 § 6 ; §§ 1, 3, 4 et 7 amendés par 0149) |
| 0135 | Time waster : le fan qui parle sans jamais acheter reçoit une attention rare, jamais du mépris ; le premier achat la lui rend | accepted (précise 0132, 0128, 0131, 0088, 0085, 0086, 0091) |
| 0136 | Le feed et les stories Reveal partent seuls : une séance par publication, au moins trois par semaine, une story par jour, avec droit de retrait | accepted (amende 0044 § 3 et § 4, 0055 § 5 ; précise 0044 § 6, 0083, 0126) |
| 0137 | Le Mass DM part seul : une annonce à tous après chaque publication du feed, un réveil avec un média demandé exprès quand plus personne ne parle | accepted, amendée deux fois le 16/11 (amende 0044 § 5 ; précise 0110 § 5 et § 6, 0136, 0126) |
| 0138 | Aperçu net du coffre : la petite image de Reveal lue à la demande, servie sans être gardée | accepted (précise 0099 § 7, 0030 § 4, 0018 ; amende 0099 : l'écran du coffre montre l'image à la demande) |
| 0140 | La semaine de la créatrice : deux jours de tournage qu'elle choisit, une livraison le dimanche, un agenda que le code remplit | accepted (précise 0042 §§ 3-5, 0055 §§ 4-5, 0056 § 2, 0126, 0136, 0137, 0120, 0082) |
| 0143 | Ses pratiques et savoir-faire, et ses comptes : l'agent en parle juste, sans rien inventer, et oriente le fan vers le bon compte | accepted (précise 0079, 0021, 0088, 0126, P4-01) |
| 0144 | Le MCP suit le CRM de novembre : coffre, branches, Playground, copilote, semaine de la créatrice, trophées et liens, en lecture seule | accepted (précise 0105 § 4) |
| 0145 | Les dossiers du coffre ont un rôle : un dossier par script, une réserve Mass DM et une réserve Feed à nous, le code lit le rôle et jamais le nom | accepted (amende 0099 § 2 ; précise 0056 §§ 5 et 7, 0113 § 5, 0018, 0136, 0137) ; avenant du § 5 accepté le 17/11 (import au choix, description sur sélection, plus d’interrupteur des descriptions ; amende 0113 § 5 et 0083 § 9) |
| 0146 | Le Dashboard de l'agence se lit par jour, semaine, mois ou période choisie, et se compare à la période qu'on choisit | accepted (précise 0078 § 3 et § 5) |
| 0148 | L'IA d'une créatrice : un interrupteur qui dit l'état en clair, une pause rapide, et ses heures à elle dessinées sur une frise | accepted (précise P3-14, 0126 §§ 13 et 17, 0019, 0024, 0149) |
| 0149 | La fiche d'une créatrice en sept onglets : tout ce qui la concerne au même endroit, la section Scripts du menu retirée | accepted (amende 0134 §§ 1, 3, 4, 7 ; précise 0042 § 7, 0099, 0112, 0137, 0145, 0148) |
| 0150 | Les alertes de chaque créatrice : l'équipe décide, dans sa fiche, qui reçoit quoi et ce qui est en sourdine | accepted (précise P4-01, 0020, 0042 § 7, 0091, 0128 § C, 0143 § 13) |
| 0151 | Les idées apprennent ses goûts et ce qui marche : profil de goûts tenu par le code, dosage valeur sûre, variation et nouveauté, mesure rapportée à son audience | accepted (précise 0060 §§ 3-6, 0120 § 2, 0140 ; amende 0060 § 4) |
| 0152 | Hébergement : un VPS Hostinger avec Coolify, la base chez Supabase, les coffres de stockage chez d'autres fournisseurs | accepted (remplace 0027 sur le lieu et 0005 sur la base de production ; précise 0028, 0037, 0067, 0087) |
| 0153 | Le chatteur voit, pendant son shift, une fiche courte de la créatrice : qui elle est, comment elle écrit, ce qu'elle ne fait jamais | accepted (précise 0025, 0022, 0149) |
| 0154 | L'IA connaît la bio de la créatrice sur la plateforme : lue en lecture seule, gardée avec le compte, donnée à l'IA comme une donnée, la bio prime sur la fiche | accepted (précise 0110, 0018, 0079) |
| 0156 | Après une étape payante, elle continue de chatter : achat vu et aftercare, refus dans l'ordre, étape oubliée, aide au paiement, relances de vente | accepted (précise 0103, 0088, P6-02) |
| 0158 | Elle a du caractère et vend comme une fille : au revoir, bouderie, lassitude, répartie, mémoire datée, rythme d'un script | accepted (précise 0135, 0128, 0156 ; amende `protectionFor` pour l'insulte) |
| 0159 | Une demande sur mesure passe par l'accord et le prix de la créatrice ; l'IA prend la commande avec un acompte par pourboire et livre depuis un dossier rattaché au fan | accepted (remplace 0090 § A points 1 et 2 ; précise 0145, 0150, 0135, 0018, 0021, 0088) |
| 0160 | Durée des sessions selon le rôle : le propriétaire 48 heures sans activité, la créatrice 7 jours, les autres 12 heures | accepted (amende 0046 § 6) |
| 0161 | Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse | accepted (amende 0099 §§ 1 et 5, 0098 § 6, 0112 §§ 20 et 23) |
| 0141 | Un copilote qui aide vraiment le chatteur : quoi faire, pourquoi, où en est la vente, et des accroches à la demande | proposed (précise 0086 § 3 et § 10) |
