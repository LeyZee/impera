# 0161. Seulement nos scripts : Impera prépare, Reveal reçoit, jamais l'inverse

Statut : accepted (Charles, 20/11/2026 17 h 44 heure de Paris, carte de décision « Oui, comme écrit », sur sa règle de 17 h 34 ; texte relu par Bilan)
Date : 2026-11-20
Amende : l'ADR 0099 § 1 (deuxième temps, « importer les scripts existants ») et § 5 (ordre des descriptions), l'ADR 0098 § 6 (le cerveau choisit un script sur son identité validée) et l'ADR 0112 §§ 20 et 23 (la liste de l'onglet Scripts, la reconnaissance d'une copie).
Précise : l'ADR 0112 § 22 (recopie à la main) et l'ADR 0099 § 6 (création par le connecteur, inchangée et toujours fermée).

## Contexte

Le 20/11/2026, Charles ouvre l'onglet Scripts sur son PC et voit 628 scripts venus de Reveal, à valider un par un, alors qu'il n'en a créé aucun dans Impera. La lecture faite par Bilan sur sa base montre que ce sont des scripts natifs enregistrés par un ancien outil : 627 d'entre eux n'ont qu'une étape, et il n'y a que 245 noms distincts.

Sa règle, dans ses mots : ces scripts Reveal, « on s'en fout ». Ce qui compte, ce sont les médias du coffre pour faire nos propres scripts. Une fois nos scripts prêts, il faut pouvoir les porter facilement dans Reveal, « mais pas le contraire ».

L'ADR 0099 (12/11) disait l'inverse sur un point. Son deuxième temps importait les scripts existants de Reveal pour que l'agent puisse les proposer, chacun après validation de son identité (ADR 0098 § 6) sur la carte « Ses scripts dans Reveal ». Depuis, l'ADR 0112 (scripts à branches) a fait d'Impera le lieu où un script se prépare, se recopie dans Reveal et se reconnaît à l'import suivant (§§ 21-23).

## Décision

1. **Un script vit d'abord dans Impera.** Le seul chemin est Impera vers Reveal. Un script se prépare dans l'éditeur (ADR 0112 § 21). Aujourd'hui, quelqu'un de l'agence le recopie à la main en suivant « À copier dans Reveal » (§ 22). Une création par le connecteur (ADR 0099 § 6) reste possible plus tard, sur une décision séparée ; tant que l'écriture du compte n'est pas ouverte, rien ne change de ce côté.

2. **Les scripts natifs ne s'affichent plus et ne se valident plus.**
   - La carte « Ses scripts dans Reveal » quitte l'onglet Scripts.
   - La liste « Scripts » (ADR 0112 § 20) ne montre que nos scripts en préparation, y compris ceux qu'un import a reconnus, marqués « Dans Reveal ».
   - Aucun écran ne propose de valider l'identité d'un script natif. Le lien du Playground qui menait à cette carte mène au script préparé.

3. **La lecture des scripts Reveal reste interne.** La synchronisation continue de lire les séquences et leurs étapes. Elle sert à deux choses seulement : reconnaître la copie d'un de nos scripts (ADR 0112 § 23), et relier les étapes vendues à l'historique du fan. Aucune table n'est supprimée, aucune ligne effacée, aucune migration écrite pour cette décision. Le MCP en lecture seule (ADR 0144) les lit toujours tels qu'ils sont.

4. **Seule une copie reconnue d'un de nos scripts peut être offerte.**
   - Un script natif non reconnu n'est jamais jouable ni vendu, quelle que soit l'identité qu'il porterait. Il n'entre pas non plus dans le compte des scripts jouables qui permet à l'IA de parler. Ce compte ne retient que nos scripts préparés dont la copie est reconnue.
   - Une créatrice qui a des centaines de scripts natifs et aucun script préparé reconnu n'a donc aucun script jouable, et l'IA ne parle pas. C'est écrit en test.

5. **Une copie reconnue reprend ce que nous avons écrit.** Il n'y a plus d'identité à valider.
   - Ce que le cerveau lit pour choisir un script (ADR 0098 § 6) devient la description de notre script préparé, avec son moment. Cette description a été écrite par un humain dans l'éditeur et vérifiée contre la persona active (manque `disgust`, ADR 0112 § 14).
   - Les réglages qui ne vivent qu'à Impera (conditions, messages après le média, rythme) passent déjà sur la copie (§ 23).
   - Les lignes d'identité existantes de scripts natifs sont ignorées, pas effacées.
   - Si la copie a changé chez Reveal après sa reconnaissance (nombre d'étapes ou prix différents de notre script), elle n'est plus offerte, et rien ne part à un prix qui n'est pas le nôtre. Chaque média de la copie doit toujours avoir une description validée.

6. **La reconnaissance ne devine jamais.** L'ADR 0112 § 23 est précisée sur trois points.
   - Une séquence n'est reconnue que si elle a le même nom (espaces de bord retirés) et le même enchaînement : nombre d'étapes, branches à chaque rang, mêmes médias, mêmes prix.
   - Si plusieurs séquences correspondent, aucune n'est rattachée. La fiche le dit, et un humain tranche ; ce n'est jamais la première venue. Des noms en double sont fréquents chez un compte qui a utilisé un autre outil.
   - Une séquence créée chez Reveal avant que notre script soit passé « Prêt à copier » ne peut pas en être la copie.

7. **La description des médias suit nos scripts.** L'ordre de l'ADR 0099 § 5 (d'abord les médias des scripts importés) est remplacé par : d'abord les médias de nos scripts préparés, puis l'ordre du coffre. Rien ne se décrit sans le geste du propriétaire, avec le coût affiché avant. Un média n'est jamais décrit d'office parce qu'il figure dans un script natif.

8. **Qui livre quoi, dans l'ordre.**
   - **Écran** (fil Scripts à branches) : la carte et ses appels quittent le web ; nos scripts reconnus s'affichent « Dans Reveal ». Un premier filtre, déjà livré, n'y laissait que les copies reconnues.
   - **Agent** : `agentScriptViewOf` n'accepte qu'une copie reconnue, avec la description de notre script ; c'est un petit lot après son lot 1. Le module des scripts expose, par son index, la lecture « copie reconnue vers son script préparé ».
   - **Routes d'identité des scripts natifs** (valider, corriger) : elles restent au serveur, propriétaire seul comme aujourd'hui, et partent avec le lot d'Agent.

## Conséquences

- Charles ne voit plus que ses scripts, ceux qu'il a faits. Les centaines de scripts d'un ancien outil ne lui demandent plus rien.
- L'agent ne vend que ce que l'agence a préparé, relu et recopié. C'est la même règle que pour les médias : rien n'est proposé sans un humain qui l'a vu.
- Un script déjà présent dans Reveal et jamais préparé chez nous ne se vend plus par l'IA. Pour le revendre, on le refait dans l'éditeur à partir des mêmes médias, puis on le recopie.
- Les données de Reveal restent lues et gardées : revenir en arrière ne demande qu'un écran, pas une reprise de données.

## Alternatives rejetées

- **Filtrer la carte sans la retirer** : c'était le premier correctif. Charles n'a aucun usage de cette carte, et la garder laissait un geste de validation sans objet.
- **Importer les scripts natifs comme scripts préparés** : ce serait exactement « le contraire » qu'il refuse, et cela recopierait chez nous des centaines de scripts d'un autre outil.
- **Faire écrire l'identité d'une copie par l'IA puis la valider** : un geste de plus pour un texte que nous avons déjà écrit nous-mêmes dans l'éditeur.
- **Effacer les scripts natifs de la base** : action irréversible, sans gain, et la reconnaissance en a besoin.
