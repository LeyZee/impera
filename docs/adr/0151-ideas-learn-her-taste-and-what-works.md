# 0151. Les idées apprennent ses goûts et ce qui marche : un profil de goûts tenu par le code, un dosage entre valeur sûre, variation et nouveauté, une mesure rapportée à son audience

Statut : accepted (Charles, 19/11/2026, 16 h 58, « ok 0151 » ; demande de Charles du 17/11/2026, 13 h 54 ; les cinq points acceptés à 13 h 56, « Oui, à fond. Vas-y sur tout ça, je valide » ; fil « Imaginer le système Instagram »)
Date : 2026-11-19
Précise : l'ADR 0060 (§ 3 : le profil de contenu ; § 4 : les idées du jour et leurs filtres ; § 5 : son accord ou son refus ; § 6 : le retour), l'ADR 0120 (§ 2 : les relevés de ses médias), l'ADR 0140 (la semaine de la créatrice), l'ADR 0042 (ce qu'elle voit).
Amende : l'ADR 0060 § 4, filtre « une idée trop proche d'une idée des 30 derniers jours est retirée » (§ 3 ci-dessous).

## Contexte

Charles veut que les idées proposées à la créatrice suivent la logique des réseaux : repartir de ce qui a déjà marché chez elle, regarder ce qui marche chez les comptes proches et dans les tendances, rester dans ce qu'elle fait tout en amenant du nouveau. Il veut aussi que ses accords et ses refus affinent la suite, « un peu comme sur Insta quand tu dis ce post ne m'intéresse pas », et parle d'« entraîner une IA exprès pour ça ».

L'ADR 0060 couvre déjà les sources, le profil de contenu rédigé par l'IA et relu par l'agence, les trois idées du jour, la validation de l'agence, l'accord ou le refus de la créatrice et le retour des chiffres. Elle ne dit pas quoi faire de ses refus au-delà de « jamais reproposée », retire toute idée proche d'une idée récente, ce qui empêche de rejouer un format gagnant, et ne dit pas comment doser le connu et le nouveau.

Entraîner un modèle n'a pas de sens ici : quelques dizaines d'accords et de refus par créatrice n'apprennent rien de fiable à un modèle, et un modèle entraîné ne s'explique pas. Un profil lisible, tenu par le code, donne le même effet et se corrige d'un geste.

## Décision

### 1. Deux signaux séparés

- **Ce qu'elle aime faire** : ses accords et ses refus d'idées.
- **Ce qui marche** : les résultats de ses publications.
- Ils ne sont jamais fondus en une seule note. L'agence lit les deux côte à côte : un format qu'elle aime et qui ne marche pas, ou qui marche et qu'elle refuse, est une information pour l'agence, pas un calcul à cacher.

### 2. Le profil de goûts

- Chaque créatrice a un **profil de goûts** (`taste_profile`), calculé par le code, jamais rédigé par un modèle : pour chaque format, thème et effort de tournage, combien d'idées elle a acceptées et refusées, et pourquoi.
- Quand elle refuse une idée, elle peut dire pourquoi d'un geste : « pas mon style », « trop long à tourner », « déjà fait », « pas maintenant ». La raison est facultative. « Pas maintenant » ne compte pas contre le format.
- Les gestes récents pèsent plus que les anciens ; la durée est un réglage d'agence.
- La génération reçoit le profil de goûts comme des faits, à côté du profil de contenu. Le code écarte ensuite toute idée d'un format ou d'un thème qu'elle refuse nettement, sauf la part de nouveauté du § 4.
- Le profil de goûts ne contient **aucune donnée de fan** et rien de l'intime de sa persona : seulement des formats, des thèmes, des efforts de tournage et ses gestes sur des idées.
- L'agence voit le profil de goûts et peut remettre un format à zéro. La créatrice ne le voit pas (ADR 0042).

### 3. Rejouer ce qui a marché

- Le filtre de l'ADR 0060 § 4 change : une idée est retirée si elle répète **le même sujet** qu'une idée des 30 derniers jours. **Le même format avec un angle nouveau est permis**, et voulu quand ce format ressort chez elle.
- Une idée née d'une de ses publications qui a marché le dit dans sa raison (« ton Reel du 3 a bien marché, même format, autre décor »), avec des chiffres que la génération a reçus et jamais inventés (ADR 0060 § 6).
- « Une idée refusée n'est jamais reproposée » reste vrai pour l'idée elle-même.

### 4. Le dosage

- Les idées du jour suivent un **dosage** (`idea_mix`) : par défaut une **valeur sûre** (un format qui a marché chez elle), une **variation** (proche de ce qu'elle fait, tirée d'un compte de référence ou d'une tendance) et une **nouveauté** (hors de ses habitudes, mais dans ce qu'elle sait faire et a sous la main). Le dosage se règle par créatrice.
- Chaque idée porte sa sorte ; le code compose le jour, pas le modèle. S'il manque une sorte ce jour-là, la place reste vide plutôt que remplie par une autre.
- Une nouveauté respecte les mêmes filtres que les autres : ses dégoûts et limites, « jamais de nu » en public, la garde Instagram.
- Ces idées nourrissent sa semaine (ADR 0140) par le chemin de l'ADR 0060 § 5 : rien ne change à la validation de l'agence.

### 5. Mesurer juste

- Le résultat d'une publication est lu **rapporté au nombre d'abonnés du compte au moment de la publication**, pour comparer un Reel d'aujourd'hui à un Reel d'il y a trois mois.
- L'ordre de lecture est : partages et enregistrements, puis portée hors abonnés, puis commentaires, puis j'aime. Les seuils qui disent « a marché » sont des réglages d'agence, jamais écrits dans le dépôt.
- « A marché » se dit d'une publication par rapport aux autres publications **du même format** du compte, jamais d'un format contre un autre.
- Tant qu'un format n'a pas assez de publications pour être comparé, il n'est ni une valeur sûre ni un échec : le code le dit « pas encore mesuré ».

## Conséquences

Positives :
- Elle reçoit des idées qui lui ressemblent de plus en plus, sans questionnaire.
- Un format gagnant est rejoué au lieu d'être écarté par le filtre des 30 jours.
- L'agence comprend pourquoi une idée est proposée, et peut corriger le profil.

Négatives, à surveiller :
- Un profil de goûts enferme : la part de nouveauté existe pour ça, et l'agence peut remettre un format à zéro.
- Peu de données au début : les trois sortes ne sont pas toujours remplies.
- Le nombre d'abonnés au moment d'une publication ancienne n'est connu qu'à partir du branchement du compte (ADR 0120).

## Alternatives rejetées

- **Entraîner un modèle sur ses accords et refus** : trop peu de données, résultat inexplicable et impossible à corriger d'un geste.
- **Une seule note par idée**, mélange de ses goûts et des résultats : elle cache à l'agence le désaccord entre les deux.
- **Laisser le modèle doser** entre connu et nouveau : une règle de métier vit dans le code.
- **Compter les j'aime d'abord** : ce n'est pas ce que la plateforme récompense le plus.
