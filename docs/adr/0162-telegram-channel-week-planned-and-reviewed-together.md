# 0162. Canal Telegram : la semaine est planifiée d'avance, revue à deux, et rien ne laisse de trou

Statut : accepted (Charles, 21/11/2026 13 h 52 heure de Paris, « ok décision Telegram » ; demande du même jour, 13 h 20 heure de Paris, et ses réponses de 13 h 35, 13 h 41, 13 h 43 et 13 h 44, fil « Publier sur Telegram à sa place »)
Date : 2026-11-21
Précise : l'ADR 0080 (créneaux, aperçu, pool, lien, post principal et posts d'engagement), l'ADR 0136 § 5 (plan de la semaine) pour le seul canal Telegram, et l'ADR 0140 (« Ma journée » de la créatrice).
Remplace : dans l'ADR 0080, § 1.1 à 1.3 (créneaux à heure fixe, 3 h d'écart) par les fenêtres du § 2 ci-dessous ; § 2.6 (validation au fil de l'eau) par la revue de la semaine du § 3 ; § 3.1 (« jamais publiés sur ce canal ») et § 3.4 (« jamais un média déjà publié reposté ») par le § 6 ; § 3.2 (la vidéo publique Reveal, une sur deux) par le § 5. Le reste de l'ADR 0080 tient.
Remplace aussi : la règle de Charles du 20/11/2026 « listes à cocher, rien n'est publié à sa place », pour Telegram seulement.

## Contexte

Le 21/11/2026, Charles lance la publication sur le canal Telegram de la créatrice à sa place, avec des textes écrits par l'IA. Ce que le canal doit faire, dans ses mots : une **source d'acquisition** qui crée de l'engagement **tous les jours, en continu**, pour que la communauté soit vivante et que le trafic vers Reveal ne s'arrête pas. On y donne des **petites news** de la modèle, parce que les fans cherchent de la proximité : des petits messages d'elle, des sondages, de temps en temps une photo ou une courte vidéo. Le soir, l'appel à venir : sur le canal on ne peut pas lui parler, donc « si tu veux papoter, faire connaissance, voir tout mon boudoir, c'est ici que ça se passe, et c'est gratuit ».

Le rythme du 20/11 (trois posts par jour : deux écrits, et le soir un post avec un visuel) reste. Ce qui est neuf : tout se planifie à la semaine, Charles **et** la créatrice peuvent relire et corriger, et un post que personne n'a relu part quand même, parce qu'un trou casse l'habitude des abonnés.

Ce que Telegram permet, vérifié le 21/11/2026 :
- un bot ne peut pas programmer un message dans Telegram : c'est Impera qui l'envoie à l'heure ;
- un bot ne peut pas publier de story pour un canal (l'API des bots ne le permet que pour un compte business) ;
- un bot ne lit pas l'historique du canal d'avant son arrivée, et ne voit pas les vues d'un post ; il voit les réactions (compteurs anonymes) sous les posts du canal dont il est administrateur ;
- la création d'un bot se fait à la main chez BotFather ; l'ajout du bot à un canal peut se faire en un geste par un lien qui ouvre Telegram avec les droits déjà cochés.

## Décision

### 1. Trois posts par jour, chacun avec son rôle

1. Chaque jour, par défaut : **un post du matin** et **un post de l'après-midi**, d'engagement (ADR 0080 § 5.8.2), et **un post du soir**, principal (ADR 0080 § 5.8.1), qui porte le lien de redirection. Réglable par créatrice ; au plus un principal par jour, comme avant.
2. Un post d'engagement est un texte seul par défaut, avec une photo de son stock Telegram (`telegram_post`) quand il y en a ; au plus un sondage par jour (ADR 0080 § 5.7).
3. Les sujets d'engagement : de petites news d'elle, ses avis, des questions de fille qui plaisent aux garçons (une tenue, un maquillage, « lingerie verte ou noire pour ma prochaine séance ? »), ses passions et leur actualité (§ 4), et l'envie de papoter (« ce soir je m'ennuie, qui est dispo ? »).

### 2. Des fenêtres, pas des heures fixes

1. Chaque post a une **fenêtre** dans le fuseau de la créatrice : matin **9 h – 11 h**, après-midi **13 h – 15 h**, soir **18 h – 21 h**. Réglables par créatrice.
2. L'heure exacte est **tirée au hasard** dans la fenêtre au moment de la planification, puis **figée et affichée** : on sait toujours quand un post part. Deux posts d'un même jour sont à 2 h d'écart au moins.
3. Plus tard, les clics du lien de redirection, comptés par heure par le service de redirection, servent à déplacer les fenêtres. Rien d'automatique : une suggestion à l'écran, que le propriétaire accepte.

### 3. La semaine planifiée et revue à deux

1. Chaque **samedi à 18 h** (heure de la créatrice), le code planifie la semaine suivante, du lundi au dimanche : pour chaque post, l'heure, le rôle, le type (texte, photo, sondage), le thème, le média choisi s'il y en a, et un premier texte.
2. Le propriétaire **et** la créatrice sont prévenus **en même temps** que la semaine est prête. Le dimanche est le jour conseillé pour la revue, pas une obligation.
3. Chacun des deux peut, pour chaque post : **Valider**, **Modifier le texte à la main**, **Réécrire** avec un conseil (ADR 0080 § 2.3), **Changer de média**, **Retirer**. L'écran dit qui a fait quoi. Un manager actif a les mêmes gestes que le propriétaire (ADR 0080 § 2.3).
4. **Retirer ne laisse pas de trou** : le code propose aussitôt un autre post pour la même fenêtre, à relire comme les autres. Un post n'est vraiment sauté que si le remplaçant est retiré à son tour.
5. **Rien n'attend personne** : un post que personne n'a relu part à son heure. La relecture est un droit, jamais une condition. L'interrupteur « Publier sans validation » de l'ADR 0080 § 2.6 reste : éteint, un post non validé ne part pas (pour la mise en route, ou une créatrice qu'on veut tenir de près).
6. **Les textes d'actualité sont rafraîchis la veille** : un post dont le thème dépend du moment (actualité d'une passion, nouvelle séance) est réécrit la veille à 18 h, avec ce qu'on sait alors. Un texte **validé ou modifié à la main n'est jamais réécrit** par le code.
7. L'aperçu une heure avant dans le groupe Info de l'agence (ADR 0080 § 2.2) reste, et les gestes restent possibles jusqu'à l'heure.
8. L'écran de la revue s'appelle **« Ma semaine à valider »**. Il accueille d'abord le canal Telegram ; les Mass DM Reveal (ADR 0137) et les publications Reveal (ADR 0136) y entreront quand ils seront codés, au lieu d'avoir chacun leur écran.

### 4. Ce que l'IA sait, et jusqu'où elle invente

1. L'IA qui écrit les posts lit : la **fiche persona** active (passions, goûts, univers), les **trois derniers posts** du canal, les **publications et stories Reveal** confirmées publiées (ADR 0136 § 8), et, quand elles existent, ce qui est paru sur son **Instagram**. Tout entre dans le prompt comme une donnée, dans des blocs délimités et typés.
2. **L'actualité de ses passions** : une fois par semaine, à la planification, une recherche sur le web rapporte quelques nouveautés liées à ses passions (cinéma, jeux…). Coût : quelques centimes par semaine et par créatrice, compté dans le plafond de dépense IA.
3. **Avis oui, emploi du temps non.** Elle peut donner son avis, poser une question, dire une envie (« GTA 6 est sorti, vous allez m'oublier ? », « j'ai adoré m'y perdre »). Elle ne raconte jamais une activité qui la rendrait indisponible pour parler ou qui la place quelque part (« j'ai joué toute la nuit », « je suis au resto »), ni une durée ou une heure précise d'une activité : un fan qui lui en reparle en privé trouverait le chat incohérent. Dire qu'elle est là et qu'elle a envie de papoter (« ce soir je m'ennuie ») est permis, puisque le chat répond.
4. Une activité réelle n'est racontée que si elle vient d'une source : sa story ou son post Instagram, sa publication Reveal, sa fiche, ou une ligne qu'elle a tapée dans son appli.
5. **Le chat suit le canal** : l'agent de chatting reçoit les trois derniers posts partis sur le canal (texte et description courte du média, moment relatif), seulement une fois que Telegram les a acceptés, comme le bloc `<her_posts>` de l'ADR 0136 § 8.

### 5. Le post du soir

1. Il **réagit au visuel** et donne envie de venir parler sur Reveal : « je viens de poster une nouvelle séance privée, j'ai hâte de savoir ce que tu en penses », l'envie de papoter, tout son boudoir, et que c'est gratuit.
2. **Le visuel** est le plus engageant parmi ce qui est **public** : le visuel de la vidéo du jour du feed public Reveal, celui du Mass DM qui annonce une séance (ADR 0137), ou une photo de son stock Telegram. Jamais un média vendu ni un média de script. Le code fait la liste des visuels permis ; le modèle de langage choisit dans cette liste, d'après les descriptions validées (ADR 0083), celui qui donne le plus envie de parler, et dit pourquoi en une ligne (visible dans la revue). Rien d'explicite (canal public).
3. Sans visuel permis le jour même, un rappel part à la créatrice à 17 h ; le post part dès que le visuel arrive, jusqu'à la fin de la fenêtre du soir. Après, le § 6 s'applique.

### 6. Reposter, rarement et le meilleur

1. Chaque post du canal reçoit une **note d'engagement** : les réactions sous le post à 48 h, et les clics du lien de redirection dans les 3 heures qui suivent un post principal.
2. Quand le stock manque, un média **déjà publié sur le canal** peut repartir : publié il y a **plus de 60 jours**, **au plus une fois par semaine**, choisi parmi ceux qui ont la **meilleure note**, jamais deux fois le même en 60 jours.
3. Le reste de l'ADR 0080 § 3 tient : le pool d'abord, la demande de dépôt automatique quand il baisse, et jamais un texte seul pour un post principal.

### 7. La vente, féminine et vraie

1. Les posts utilisent les ressorts de la vente (envie, curiosité, proximité, peur de rater quelque chose), en douceur, dans sa voix, jamais visibles comme une technique.
2. Ils ne s'appuient que sur du **vrai** : « je viens de poster une séance » quand elle vient de paraître, « c'est gratuit » parce que l'abonnement l'est, « je réponds à tout le monde ce soir » parce que le chat répond. Aucune fausse échéance (« plus que 2 h »), aucune fausse rareté : les gardes de l'ADR 0080 § 5.3 et § 5.4 restent dans le code.

### 8. Les stories Telegram, en un geste

1. Quand une story Reveal part (ADR 0136 § 3), Impera prépare la même pour Telegram et prévient la créatrice et le propriétaire.
2. Un appui ouvre Telegram sur le téléphone avec le média prêt à publier en story du canal. Personne n'est obligé ; l'écran dit si elle a été reprise quand quelqu'un le coche.
3. Impera ne se connecte jamais à Telegram avec le compte d'une personne. Un canal ne peut publier des stories qu'après quelques « boosts » de comptes Telegram Premium : l'écran le dit tant que ce n'est pas le cas.

### 9. Le kit de démarrage du bot

Réglages › Telegram, en quatre étapes, environ deux minutes :
1. **Créer le bot** : un bouton ouvre BotFather avec la commande prête ; l'écran dit quoi taper.
2. **Coller le jeton** : le propriétaire le colle lui-même ; il est scellé comme les clés IA (ADR 0016) et n'apparaît jamais en clair ensuite.
3. **Ajouter à mon canal** : un bouton ouvre Telegram sur le choix du canal, avec les droits de publication déjà cochés. Impera reconnaît le canal tout seul quand Telegram l'annonce ; personne ne tape d'identifiant.
4. **Vérifier** : le bot peut publier, « Signer les messages » est éteint (ADR 0080 § 5.6), les commentaires sont fermés. Ce qui manque est dit en ambre, avec le geste pour le corriger.

### 10. « Ma journée » de la créatrice

1. Les deux lignes « posts écrits sur Telegram » disparaissent de sa journée : Impera s'en charge.
2. La ligne du soir devient **« Ton visuel du soir pour Telegram »**, cochée toute seule quand le post est parti ; elle n'apparaît que si aucun visuel permis n'est prêt pour ce soir-là.
3. Une ligne **« Tes posts Telegram de la semaine »** apparaît le samedi soir et le dimanche, avec un lien vers « Ma semaine à valider ». Jamais en rouge, jamais obligatoire.
4. La story Telegram du § 8, quand elle est à reprendre, est une ligne bonus de sa journée.

### 11. Les gardes qui ne changent pas

Aucun vrai post ne part avant le mot écrit de Charles dans le fil. Le message d'un fan n'entre jamais ici. Rien d'explicite, rien de faux, jamais dire ou laisser entendre qu'une IA écrit (ADR 0021). Aucun paiement hors de Reveal. Étanchéité entre créatrices : chaque table nouvelle a sa RLS forcée, chaque route nouvelle son test d'isolation. Aucune vraie donnée de créatrice ni nom de canal dans le dépôt.

## Conséquences

Positives :
- Le canal ne manque jamais un jour, et chacun peut relire la semaine quand il a le temps.
- La créatrice n'a plus rien à écrire pour Telegram ; elle garde un droit de regard.
- Le chat et le canal racontent la même histoire.

Négatives, à surveiller :
- Des posts partent sans relecture : les gardes du code, l'aperçu d'une heure et l'interrupteur « Publier sans validation » en sont les freins.
- La note d'engagement est pauvre au début (pas de vues, peu de réactions) : le repost ne vaut que ce que valent ces mesures.
- Les sources sérieuses sur l'engagement d'un canal Telegram sont rares (surtout des blogs d'outils) : les fenêtres et le rythme se règlent sur nos propres clics après deux ou trois semaines.

## Alternatives rejetées

- **Valider chaque post avant qu'il parte** : un trou dès que personne n'a le temps ; Charles le refuse.
- **Écrire toute la semaine le samedi sans rafraîchir** : un post d'actualité écrit sept jours avant tombe à côté.
- **Publier les stories avec le compte Telegram d'une personne** (connexion automatique) : risque de bannissement du compte et une clé qui ouvre tout son Telegram sur le serveur.
- **Des heures fixes** : un canal qui poste à la minute près sent l'automate.
- **Un écran de revue par sortie** (Telegram, Mass DM, feed) : trois écrans pour un même geste du dimanche.

## Découpage

- **Lot T1** (serveur) : planification de la semaine, fenêtres et heures tirées, rafraîchissement de la veille, envoi réel aux heures (ADR 0080 lot A3), aperçu dans le groupe Info, gestes de la revue, remplaçant d'un post retiré, note d'engagement, repost, bloc du canal pour l'agent de chatting.
- **Lot T2** (écran, après maquette validée par Charles) : « Ma semaine à valider » au téléphone et sur PC, lignes de « Ma journée ».
- **Lot T3** : kit de démarrage du bot.
- **Lot T4** : recherche hebdomadaire sur ses passions ; stories en un geste.
