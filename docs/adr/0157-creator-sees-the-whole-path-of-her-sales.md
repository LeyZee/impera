# 0157. « Ta part » montre tout le chemin de ses ventes : ce que ses fans ont payé, la TVA, Reveal, l'agence et elle, avec son pourcentage

Statut : accepted (Charles, 20/11/2026, 14 h 36, heure de Paris : « Tout le chemin de ses ventes » sur la carte de décision du fil Équipe, dont la conséquence disait « Payé par les fans, TVA, part de Reveal, part de l'agence, sa part et son pourcentage, sur SES ventes. Rien sur les chatteurs ni les autres créatrices. » ; après sa remarque de 14 h 34 sur la première version de « Ta part »)
Date : 2026-11-20
Remplace : dans la fiche CR-04 et le contrat `CreatorEarnings`, la règle « elle voit sa part seulement » (décision de Charles du 17/11, reprise le 20/11 dans la première version de « Ta part »).
Amende : l'ADR 0054 § 4, « Elle est montrée là où est le pourcentage, au propriétaire seul » (§ 3 ci-dessous).
Précise : l'ADR 0042 § 6 (le parcours ligne par ligne, « fans, TVA, plateforme, agence, toi ») et l'ADR 0054 §§ 1 à 3 (chaque montant est celui de Reveal ; elle ne voit jamais qui a vendu).

## Contexte

La première version de « Ta part » (CR-04) montre à la créatrice sa part seule, période par période, et ses ventes une à une avec sa part de chacune. C'était la règle du 17/11 : « elle voit sa part seulement ».

Le 20/11, Charles ne la valide pas : il veut un écran plus joli et plus intuitif, et une **transparence à fond**. Elle doit voir combien elle touche, son pourcentage, le chiffre global de ses ventes, sa part par rapport à ce chiffre, ce que prend l'agence et ce qu'elle prend. Il demande aussi de vérifier qu'il n'y a aucun trou en se mettant à la place d'une créatrice.

L'ADR 0042 § 6 prévoyait déjà ce parcours ligne par ligne. L'ADR 0054 a gardé chaque montant tel que Reveal le donne, et réservé la part constatée de l'agence au propriétaire. Le registre des ventes de Reveal porte, pour chaque vente, le prix payé, le hors-taxes, le net, la part de l'agence et celle du modèle : tout le chemin se lit sans rien recalculer.

Sur sa carte de décision, Charles a choisi « Tout le chemin de ses ventes » plutôt que « Total, agence et sa part » ou « Sa part seulement ».

## Décision

### 1. Le chemin de ses ventes

- Sur une période (le jour, la quinzaine ou le mois), par devise, elle voit :
  - ce que ses fans ont payé, TVA comprise ;
  - la TVA ;
  - la part de Reveal ;
  - le net ;
  - la part de l'agence ;
  - **sa part**, en premier et en plus grand.
- Chaque montant est celui du registre de Reveal, remboursements déduits comme la paie les déduit. Rien n'est recalculé, et l'écran dit « lus chez Reveal ».
- Les montants restent « estimés » tant que la période n'est pas finie (ADR 0042 § 6).

### 2. Son pourcentage

- L'écran lui rappelle **son pourcentage** : sa part divisée par le net de la période, lu dans le registre.
- Il dit aussi ce que sa part représente sur ce que ses fans ont payé, en clair (« sur 100 € payés par tes fans, tant pour toi »).
- Ce sont des pourcentages **constatés**, jamais le pourcentage convenu saisi par le propriétaire (ADR 0054 § 6). Si le partage a changé dans la période, le pourcentage du chemin est celui de la période. Chaque vente garde le sien.

### 3. Ses ventes une à une

- Chaque vente de la période montre ce que le fan a payé et sa part.
- Le fan y est nommé par le nom affiché de sa fiche chez elle, comme dans le reste de son espace, et seulement quand cette fiche est à elle ; jamais par l'identifiant de la plateforme.
- D'un geste, elle déplie le chemin de cette vente : TVA, Reveal, agence, elle.
- Un remboursement montre ce qu'il retire, et à quelle vente il se rattache.
- L'ADR 0054 § 4 est amendé : la part de l'agence constatée **sur ses propres ventes** lui est montrée, dans « Ta part ». La part constatée par compte sur 30 jours et par quinzaine, son alerte d'écart et le pourcentage convenu restent au propriétaire seul, dans la fiche de la créatrice.

### 4. Ce qu'elle ne voit jamais

- Qui a vendu : ni chatteur, ni agent (ADR 0054 § 3).
- Rien de l'équipe : ni commission, ni taux, ni prime, ni paie, ni nom de membre.
- Rien d'une autre créatrice.
- Ni le pourcentage convenu, ni l'alerte d'écart, ni ce que l'agence fait de sa part.

### 5. La base dit la même chose que l'écran

- Elle lit ses ventes par la vue `creator_sales`, qui n'a pas le vendeur (ADR 0054 § 3). Cette vue porte déjà les colonnes du chemin (prix payé, hors-taxes, net, part de l'agence, sa part) : **aucune migration**, aucun droit de base nouveau. Seule la réponse de l'API, qui ne laissait sortir que sa part, s'élargit au chemin.
- Les politiques de lignes ne changent pas : elle lit ses comptes et rien d'autre.
- La route de « Ta part » ne lit que cette vue : jamais `platform_sales` ni une table de la paie.
- Le contrat de « Ta part » reste strict : ni vendeur, ni source (IA ou humain), ni shift, ni identifiant de membre, même indirect, ne peut passer.

### 6. Ce qui le garantit

- **Le pourcentage est calculé par le serveur, sur des sommes** : sa part divisée par le net, remboursements et annulations compris. Un net nul ou une part inconnue donne un tiret, jamais une valeur déduite.
- **Le pourcentage d'une vente ne désigne pas le vendeur.** Reveal partage chaque vente entre le modèle et l'agence selon le partage du modèle, sans savoir qui a vendu : la part de l'agence ne varie pas selon le chatteur. Si un jour elle variait selon le vendeur, le pourcentage par vente disparaîtrait de l'écran.
- **Tests** :
  - la liste exacte des clés de la réponse, pour une vente et pour une période, est figée ;
  - une créatrice ne lit rien d'une autre, ni d'un compte archivé, et un compte partagé entre plusieurs créatrices reste refusé comme aujourd'hui ;
  - l'équipe et le propriétaire n'entrent pas par cette route ;
  - aucun de ces montants n'est écrit dans les journaux ni envoyé au suivi d'erreurs.
- **Toute autre porte** qui servirait ces chiffres (export, agent connecté) suit le même contrat. Aujourd'hui il n'y en a aucune.
- Sécurité a relu ce droit de lecture avant le code (fil Sécurité, 20/11/2026).

## Conséquences

Positives :
- Elle comprend d'où vient son argent sans rien demander à l'agence.
- Un seul chiffre par montant, celui de Reveal, de la vente au total.
- Le chemin de la quinzaine se rapproche de ce que Reveal lui reverse.

Négatives, à surveiller :
- Elle voit ce que prend l'agence vente par vente. C'est voulu (Charles, « transparence à fond »), mais une question sur le partage arrivera plus vite à l'agence.
- **En voyant son pourcentage constaté, elle peut constater elle-même un écart avec ce qui était convenu.** C'est la conséquence du choix de Charles, pas une fuite. Elle le verra parfois avant que l'agence l'ait expliqué ; l'alerte d'écart de l'ADR 0054 § 5 prévient le propriétaire au même moment.

## Alternatives rejetées

- **Total, agence et sa part**, sans la TVA ni la part de Reveal : le net « disparaît » entre le prix payé et les deux parts, et la question « où est passé le reste ? » reste ouverte.
- **Sa part seulement** (sa part et son pourcentage) : pas de chiffre global, ce que Charles a demandé.
- **Calculer le chemin avec la TVA et le pourcentage convenu** : deux chiffres pour une même vente, le nôtre et celui de Reveal (ADR 0054, alternatives).
