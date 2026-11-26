# 0169. Un script porte sa langue ; sa version dans une autre langue est un script lié, aux mêmes médias et aux mêmes prix

Statut : accepted (Charles, 26/11/2026 17 h 05 heure de Paris, « corrige tout ça », sur l'état des lieux de la langue du fan et ses recommandations ; lot 2 de la spécification)
Date : 2026-11-26
Précise : l'ADR 0112 (§§ 20 à 23, scripts en préparation et reconnaissance d'une copie) et l'ADR 0161 (§§ 4 et 5, seule une copie reconnue d'un de nos scripts est offerte).
Va avec : l'ADR 0168 (la langue du fan, gardée par fan, décidée en code).

## Contexte

L'agent répond au fan dans sa langue quand la fiche de la créatrice la contient (ADR 0168). Les textes d'un script, eux, sont écrits une fois, en français : l'accroche, le texte d'offre, les messages après le média. Un fan anglophone recevrait donc son offre en français au milieu d'une conversation en anglais.

La règle de métier est simple : aucun script n'est joué avec un fan sans une version dans sa langue. Traduire un script ne change ni ce qu'il vend ni à quel prix : seuls les mots changent.

## Décision

1. **Un script porte sa langue.** Chaque script en préparation a une langue (`prepared_scripts.language`). Ses valeurs sont celles des « Langues parlées » de la fiche persona (`LANGUAGES`), pour que l'agent la compare à celle du fan sans table de traduction. Le français est la langue par défaut ; les scripts existants sont en français.

2. **Une version dans une autre langue est un script lié.** Elle porte l'identifiant de son script (`version_of`) et sa propre langue.
   - Elle est de la même créatrice et du même compte Reveal que son script. La base le tient : clé étrangère composite (`version_of`, `creator_id`).
   - Il y en a au plus une par langue (index unique), jamais dans la langue de son script, jamais une version d'une version.
   - Elle est créée depuis son script tel qu'il est : mêmes étapes, mêmes branches, mêmes médias, mêmes prix, mêmes conditions, même rythme, même moment. Ses textes sont vides, à traduire par l'agence.

3. **Une version ne change que ses textes.** Trois lacunes s'ajoutent à celles de tout script (ADR 0112 § 13) :
   - `version_differs` : ses étapes, branches, médias, prix, conditions, rythme ou moment ne sont plus ceux de son script. Le geste « Reprendre la structure » la remet sur son script en gardant les textes de chaque branche qu'elle avait déjà.
   - `version_name_same` : elle porte le nom de son script. L'import reconnaît une copie par son nom, et deux scripts du même nom ne sont jamais rattachés (ADR 0161 § 6).
   - `version_mentions_price` : un de ses textes cite un prix ou une devise. Reveal affiche le sien.

4. **Elle suit le même chemin que tout script.** Elle passe « Prêt à copier », se recopie dans Reveal comme un autre script et se reconnaît à l'import suivant. Les textes d'une condition en texte, que l'agent lit, peuvent rester dans la langue de l'agence.

5. **L'agent ne voit que des versions fidèles.** La lecture des scripts d'un compte pour l'agent (`forJobs.accountScripts`) donne, pour chaque copie reconnue, sa langue et son script d'origine (`ours.language`, `ours.versionOf`). Une version reconnue dont le script a changé depuis n'est plus offerte. Le choix du script par la langue du fan, le décompte par famille (`versionOf ?? id`) et le seuil des scripts jouables dans sa langue sont dans le module de l'agent (ADR 0168).

6. **La traduction est humaine.** Une proposition de traduction écrite par l'IA pourra pré-remplir les textes. Elle reste relue par un humain avant tout usage, et elle n'est activée qu'avec l'accord du propriétaire sur son coût.

## Conséquences

- Un fan anglophone ne reçoit jamais une offre en français. S'il n'existe aucune version dans sa langue, aucun script ne lui est proposé.
- Traduire un script ne demande ni nouveau média ni nouveau prix, et le geste est le même que pour un nouveau script.
- Changer un script après l'avoir traduit oblige à reprendre la structure de chaque version, ce que l'écran dit.
- Les mots interdits de la persona sont écrits en français : ils ne détectent pas une traduction qui les toucherait. Les gardes du code dans chaque langue relèvent d'un lot à part.

## Alternatives rejetées

- **Les traductions rangées dans le même script** : une copie Reveal n'a qu'un texte par étape. Il faut donc un script Reveal par langue, et donc un script préparé par langue.
- **Traduire à la volée par l'IA à l'envoi** : le texte envoyé par Reveal est celui de l'étape, pas celui de l'IA ; et une traduction jamais relue pourrait toucher ses limites.
- **Laisser une version différer de son script** : deux prix pour le même contenu selon la langue du fan, ce que la règle « jamais un portefeuille » écarte.
