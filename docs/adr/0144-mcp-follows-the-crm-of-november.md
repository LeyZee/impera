# 0144. Le MCP suit le CRM de novembre : ce qui est arrivé depuis l'ADR 0105, en lecture seule

Statut : accepted (Charles, 16/11/2026, 17 h 36, « ok 0144 » ; fil « Mettre à jour le MCP du CRM », 16/11/2026 ; question de Charles du 16/11, 17 h 03 : « j'espère que le MCP est à jour par rapport à tout ce qu'on peut faire maintenant dans le CRM » ; plan en trois temps accepté le 16/11, 17 h 06, « parfait » : finir les lectures prévues, écrire cette mise à jour, puis « préparer » ; numéro 0144 attribué par le coordinateur)
Date : 2026-11-16
Précise : ADR 0105 § 4 (le catalogue de lecture suit le CRM). Ne remplace aucun ADR ; ne touche ni § 1 à § 3 de 0105 (second facteur, préparer puis confirmer, ce qui reste fermé), ni l'ADR 0058.

## Contexte

L'ADR 0105 a fixé, le 13/11, le catalogue de lecture du MCP sur le CRM de ce jour-là, et posé la règle : le MCP suit le CRM, il ne le précède pas. Depuis, le CRM a gagné des écrans et des données que le catalogue ne nomme pas : la lecture et la description des fichiers du coffre de la plateforme (ADR 0113), les scripts à branches (ADR 0112), les corrections et les leçons du Playground (ADR 0102, 0103), les propositions du copilote, la semaine de la créatrice (ADR 0042), les trophées, les séries et le jeu de l'équipe (ADR 0104, 0107, 0108), et bientôt « Mes liens » et le trafic Instagram (ADR 0120, 0121).

Charles demande que l'agent qu'il branche sur le CRM voie ce que le CRM sait faire aujourd'hui. Les règles d'argent ont aussi changé : décision A du 14/11 (aucun montant d'argent par membre ne sort du MCP), droits du manager du 16/11 (la paie d'un autre manager lui est cachée, montants et détail).

## Décision

### 1. Ce qui ne change pas

Tout ce qui suit est en lecture seule, par les lectures publiques des `index.ts`, comme la personne de l'accès et sous les politiques de l'écran. Un manager ne lit que les créatrices de sa liste ; un accès borné à une créatrice ne lit qu'elle. Jamais un média, son URL ni sa miniature ; jamais un montant d'argent par membre (décision A) ; jamais la paie d'un membre que l'écran cache à la personne. Tout texte venu d'un fan ou de la plateforme, ou écrit par un modèle, sort dans le champ `untrusted`. Ne sortent que les identifiants d'Impera : jamais un identifiant chez la plateforme, une clé de vignette, une empreinte de fichier ni un lien. Chaque outil recopie ses champs un par un sous un schéma strict propre au MCP, pour qu'un champ ajouté plus tard à l'écran ne sorte pas sans relecture.

### 2. Les lectures qui entrent au catalogue

| Ce que l'agent lit | Capacité | Portée |
|---|---|---|
| Le coffre de la plateforme : dossiers et leur nom (`untrusted`), nombre de fichiers par type, ordre de la plateforme, description validée de chaque fichier (`untrusted`), jamais le fichier ni son identifiant chez la plateforme | `read:media` | une créatrice |
| Les branches d'un script : étapes, conditions posées par le code, prix ; le texte des étapes seulement avec `read:script_content` | `read:media`, `read:script_content` | une créatrice |
| Les corrections et les leçons gardées du Playground : les échanges cités (`untrusted`) et la règle retenue, écrite par l'agence | `read:playground` (nouvelle) | l'agence, accès au nom du propriétaire seulement |
| Les propositions du copilote en attente sur une conversation (`untrusted`), le prix seulement celui de l'étape décidée | `read:conversation_content` | une créatrice de la personne, jamais un accès de créatrice |
| La semaine de la créatrice : topo (`untrusted`, écrit par un modèle), tâches proposées, état de validation | `read:status` | une créatrice |
| Trophées, séries, rangs et défis de l'équipe et de la créatrice : aucun montant, ni rien qui permette d'en recalculer un par membre | `read:team` | l'agence ou une créatrice |
| « Mes liens » et le trafic, le jour où le CRM les lit (ADR 0121) : un identifiant d'Impera, l'usage du lien et ses clics par jour ; jamais l'URL, le domaine ni le nom du lien | `read:status` | l'agence ou une créatrice |

`read:playground`, comme `read:script_content`, ne se coche que sur un accès au nom du propriétaire et jamais d'office : avec elle, la méthode de l'agence et des réponses dans la voix de la créatrice partent chez le fournisseur du modèle de l'agent, et l'écran le dit en une phrase au moment de la cocher. Une correction tirée d'une vraie conversation demande aussi `read:conversation_content`.

Les noms, adresses et domaines des liens restent hors du MCP, aucune capacité ne les ouvre (choix de Charles, 16/11/2026, 17 h 34, carte « Non, clics seulement »).

### 3. Ce qui reste fermé

Rien de ce qui précède ne s'écrit par le MCP : ni une description du coffre, ni une branche, ni une correction ou une leçon du Playground, ni une proposition du copilote, ni la semaine de la créatrice, ni un trophée. Le § 3 de l'ADR 0105 vaut tel quel. Une écriture sur l'un de ces sujets demande sa propre phrase acceptée, au lot « préparer » (ADR 0105 § 6, lot 2).

### 4. Ordre

1. Finir les lectures déjà prévues par 0026 § 5 et 0105 § 4, une PR à la fois.
2. Puis celles du § 2, dans l'ordre du tableau. Chaque outil est relu par le module qui possède la donnée et par Sécurité, avec un test qui montre qu'aucun média, aucun identifiant de plateforme, aucun montant par membre et aucun champ en trop ne sort.
3. « Mes liens » et le trafic attendent que le CRM les lise.

## Conséquences

- Positives : l'agent de Charles lit le CRM tel qu'il est, sans qu'aucune nouvelle écriture n'entre ; la méthode de l'agence ne part chez un fournisseur que sur une case cochée par le propriétaire.
- Négatives : une capacité de plus (`read:playground`) et sept outils à maintenir quand leurs écrans changent.
- À surveiller : chaque nouvel écran du CRM devrait dire, dans sa fiche, s'il entre au MCP ; sinon ce décalage reviendra.

## Alternatives rejetées

- **Ouvrir le Playground sous `read:status`** : la méthode de l'agence partirait chez le fournisseur du modèle avec une capacité que l'on coche pour des chiffres.
- **Donner au coffre ses fichiers ou leurs URL** : un média de la créatrice sortirait de l'agence par un fournisseur de modèle ; la description suffit à choisir.
- **Attendre un catalogue complet avant tout outil** : le besoin est maintenant, et chaque outil se relit mieux seul.
