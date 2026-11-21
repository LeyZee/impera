# 0163. Coffre Impera : le stock de ce qu'elle dépose, compté par usage, décrit et relu par les trois

Statut : accepted (Charles, 21/11/2026 : choix de 15 h 42 heure de Paris, « go » sur la maquette à 15 h 56, carte de décision de 16 h 31 « Pause sauf si moins de 3 scripts » ; texte à relire par Bilan)
Date : 2026-11-21
Précise : l'ADR 0055 (catégories de dépôt, une de plus), l'ADR 0044 (dépôts de contenu), l'ADR 0159 (cadeaux), l'ADR 0161 (scripts créés dans Impera, envoyés vers Reveal).

## Contexte

Elle dépose ses médias par sa to-do (Contenu). L'agence ne les voyait que dans une liste par date (Créatrices › Médias › Dépôts), elle ne les voyait plus du tout après l'envoi. Personne ne pouvait dire d'un coup d'œil combien de jours de feed, de stories ou de relances restent d'avance, ni relire la description que l'IA a écrite de chaque média.

Charles veut une vue « Coffre Impera », distincte du coffre de Reveal, qui couvre Reveal, Instagram, Telegram et les Mass DM : chaque catégorie et ce à quoi elle sert, chaque média ouvert en grand, sa description modifiable, des chiffres, pour lui au PC et pour elle au téléphone.

## Décision

1. **Une vue de stock, en lecture sur les dépôts.** Le Coffre Impera ne crée ni ne déplace rien : il lit les dépôts gardés et leurs fichiers, et les range par usage. Le coffre de la plateforme garde son nom, « Coffre Reveal ». Dans le code, la vue s'appelle `stock` (`ContentStock`), jamais `vault`.
2. **Compté par usage, avec un objectif d'avance.** Reveal (vidéos du feed, séances boudoir, stories, relances) : 7 jours d'avance. Instagram : 3 jours. Telegram suit la vidéo du feed et n'a pas d'objectif propre (bonus). Scripts : 3 jouables plus un d'avance. Cadeaux baleines : 3 inédits au moins. Les cadences par semaine sont celles du rythme réglé pour elle ; une plateforme pas encore branchée est montrée sans rien attendre.
3. **« Cadeaux baleines » devient une catégorie de dépôt** (`whale_gift`). Un cadeau n'est jamais un nu, il est inédit et jamais revendu (ADR 0159) ; un média d'une autre catégorie offert comme cadeau est signalé « pas un cadeau » par le code.
4. **La description se relit à trois.** Le propriétaire, un manager actif et la créatrice elle-même valident ou corrigent la description d'un média, sur la même vue. Elle n'y touche que pour ses propres dépôts, par sa porte (`/v1/creator-space/…`), sous une politique restrictive de la base ; chaque geste porte l'identifiant de qui l'a fait. Un chatteur n'y a pas accès.
5. **Ce qu'on voit.** L'agence (PC d'abord) : la réponse en tête (quand une plateforme tombe à sec), les jours d'avance par usage contre leur trait d'objectif, ce qu'il y a dedans, chaque catégorie avec son usage et sa règle, chaque média ouvert en grand (photo plein écran, vidéo lue), sa description. Elle (téléphone d'abord, « Mon coffre ») : le minimum du jour en gros avec « Déposer », le reste en bonus, jamais en rouge.
6. **« À remplacer », média par média.** L'agence marque un média encore en stock « à refaire » avec une phrase ; elle le voit en ambre dans son coffre et le remplace sur place. Le nouveau fichier prend la place de l'ancien partout où il sert : dans un script en préparation, automatiquement ; dans un script déjà recopié dans Reveal, le script est marqué « à mettre à jour dans Reveal » (jamais d'écriture automatique, ADR 0161) et mis en pause pour l'IA jusqu'à la recopie, **sauf** si la pause faisait tomber la créatrice sous 3 scripts jouables : l'ancienne version continue alors de se vendre. Un fan qui a acheté garde ce qu'il a acheté. Un média déjà sorti ne se marque pas ; un média programmé est déprogrammé ; tant qu'il attend, l'ancien ne sort plus. Dans un script, le remplaçant a le même type (photo ou vidéo) ; sa description repart à valider. L'agence peut annuler la marque ; l'ancien fichier reste au journal. Rappel à elle après 48 h.
7. **Ce qui n'est pas fait ici.** « Ce qui part quand » (le planning de publication) attend le moteur de publication ; « À remplacer » côté serveur appartient au module des dépôts, la propagation aux scripts au module des scripts.

## Conséquences

- Une table de plus n'est pas nécessaire : une migration ajoute la catégorie `whale_gift` et les politiques qui laissent la créatrice relire ses descriptions.
- Les routes de l'espace créatrice entrent dans le balayage d'isolation des locataires.
- Les couleurs par catégorie (dix) dépassent les quatre couleurs de série du design system : le fil Design les ajoute en jetons.
