# 0153. Le chatteur voit, pendant son shift, une fiche courte de la créatrice : qui elle est, comment elle écrit, ce qu'elle ne fait jamais

Statut : accepted (« ok 0153 » de Charles, 20/11/2026 à 13 h 01 ; trou 7 du fil « Trouver les trous de chaque onglet », demande de Charles du 20/11/2026 à 12 h 54 : « corrige tous les trous » ; bloc intime « Oui, replié », carte de décision du 20/11/2026 à 12 h 59)
Date : 2026-11-20
Précise : ADR 0025 (ce que le chatteur voit pendant son shift et sa marge), ADR 0022 (la persona fait partie de la version), ADR 0149 (fiche créatrice à sept onglets). Ne remplace aucun ADR.

## Contexte

Un chatteur humain qui reprend une conversation, ou qui écrit lui-même plutôt que d'envoyer le brouillon du copilote, n'a aucune fiche de la créatrice sous les yeux. Il voit les limites du fan et le brouillon. Il ne voit ni ce qu'elle refuse, ni son ton, ni les sujets qu'elle ne touche jamais. Rien ne l'empêche donc de lui faire dire ce qu'elle ne dirait jamais.

Côté serveur, la route de la persona est déjà ouverte au rôle `operator`, mais elle renvoie la fiche entière, seuils de l'agence compris. Aucun écran ne la montre au chatteur : son rail n'a que Aujourd'hui, Suivi, Planning, Commissions et Moi.

## Décision

1. **Une fiche courte, en lecture seule, pendant son shift seulement.** Le chatteur voit la fiche de la version active d'une créatrice dans la même fenêtre que le reste de l'ADR 0025 : un shift qui la couvre, avec la marge avant et après réglée par le propriétaire (`onShift`, garde du serveur). Hors de cette fenêtre, ou pour une autre créatrice, la réponse est 403, et chaque ouverture est inscrite au journal comme une fiche de fan. Il ne voit jamais les brouillons, les anciennes versions ni l'historique.
2. **Liste blanche, pas liste noire.** Le serveur renvoie un schéma à part (`ChatterPersonaSheetSchema`, Zod), construit champ par champ (`chatterSheetOf`) à partir des sept panneaux de sa fiche et de ses règles. Route : `GET /v1/creators/:creatorId/persona/chatter`, 403 `persona_shift_forbidden` hors fenêtre. Un champ ajouté plus tard à la persona reste caché tant qu'une ADR ne l'ajoute pas ici.
3. **Ce qu'il voit**, regroupé comme dans la fiche :
   - **Elle** : son prénom de créatrice, son âge du jour (jamais la date de naissance), sa ville et son pays, son métier, ses langues, sa situation de couple et d'enfants ; son mode de vie (tabac, alcool, voyages, routines, animaux) et ses goûts (plats, musique, films, passions…), que les fans lui demandent.
   - **Son physique** (les fans le demandent) : sa description, taille, poids, yeux, cheveux, poitrine, pointure ; un champ vide ne s'affiche pas.
   - **Comment elle écrit** : son panneau « Conversation » (sa façon de parler, son orthographe, ses expressions, ses emojis préférés, comment elle reçoit un compliment et flirte, ses réponses types, ce qui sonne faux), les surnoms qu'elle donne et les emojis qu'elle n'utilise jamais.
   - **Ses limites**, en premier et toujours dépliées : ce qu'elle ne fait jamais, ne montre jamais, ne dit jamais, ses dégoûts, ses sujets interdits, ses zones interdites et ce qui la refroidit.
   - **L'intime** : son panneau « Intimité » (sauf les zones interdites, rangées avec ses limites), ce qui l'excite et son nombre de partenaires s'il est rempli. Le chatteur en a besoin pour vendre comme elle. Ce bloc est replié par défaut, sous ses limites (choix de Charles).
4. **Ce qu'il ne voit jamais** : tout ce qui relève de la méthode de l'agence. Cela couvre les seuils (KYC, sexualisation, désir avant un script, délais, cooldowns, relances), les prix, les styles de stratégie et de lancement de script, les mots d'alerte, les interrupteurs de l'agent et les notes internes de la fiche.
5. **Où** : un pli « Elle » dans le panneau du fan, là où il travaille. Le chatteur chatte dans Reveal (ADR 0025) : le pli est dans le panneau de l'extension à côté de la conversation Reveal, et dans la fiche du fan de Suivi. Pas d'onglet de plus dans son rail. Le pli s'ouvre sur ses limites. Design relit l'emplacement ; les captures (Nuit/Jour, PC/téléphone) sont validées par Charles avant la fusion.
6. **Ce que le code vérifie** : la route refuse hors shift et hors créatrice (test d'isolation), la réponse ne contient aucun champ hors liste (test sur le schéma), et les balayages d'authentification et d'origine couvrent la route.

## Amendement du 21/11/2026 : la fiche entière, propriétaire et manager actif seulement

Charles l'a tranché le 21/11 sur une carte du fil Sécurité (« Oui, fiche courte pour le chatteur ») : seuls le propriétaire et un manager actif, sur les créatrices de sa liste, lisent sa fiche entière (`GET /v1/creators/:creatorId/persona`). Le manager la lit sans pouvoir la changer : écrire une version et l'activer restent au propriétaire. Tout autre opérateur, chatteur compris et même sans fiche d'équipe, reçoit 403 `persona_full_forbidden` et lit la fiche courte de cette ADR. Le serveur le vérifie par la portée d'équipe (`agency`, ADR 0024), pas seulement l'écran.

## Conséquences

- Positives : le chatteur écrit dans sa voix et ne franchit plus ses limites par ignorance ; la méthode de l'agence ne sort pas.
- Négatives : un chatteur qui ouvre la fiche pendant un shift peut la recopier ; c'est le prix de la lui montrer. Seul le strict nécessaire est affiché, et seulement pendant son shift.
- À surveiller : si un chatteur fait encore des faux pas sur une limite affichée, on ajoutera au copilote un avertissement quand ce qu'il tape touche une de ses limites (garde existante `never_say` lue sur le texte du chatteur), dans une ADR suivante.

## Alternatives rejetées

- **Lui ouvrir la fiche entière.** Elle contient les seuils et la méthode de l'agence, secrets par principe.
- **Un onglet « Créatrices » dans son rail.** Il faudrait quitter la conversation pour le lire ; le pli dans le panneau du fan est là où il en a besoin.
- **Visible en permanence pour ses créatrices habituelles.** Pas utile hors shift, et cela élargit sans raison qui voit quoi (ADR 0025).
- **L'intime caché au chatteur.** Il sexte et vend dans sa voix ; sans ce bloc, il improvise. Replié, il ne s'étale pas à chaque ouverture (choix de Charles).
