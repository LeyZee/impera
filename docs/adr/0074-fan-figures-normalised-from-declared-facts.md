# 0074. Les chiffres de sa base : quels faits comptent, et comment âge, lieu, métier et situation se rangent en cases

Statut : accepted (Charles, 06/11/2026 14h48, « ok 0074 », chat du projet ; choix « parts » du § 8 tranché par Charles le 06/11/2026 à 13h18, « ok parts », sur la relecture de Bilan)
Date : 2026-11-06
Précise : l'ADR 0063 § 2 (« Les tranches et ce seuil seront fixés par une ADR courte, avant le code ») et l'ADR 0065 § 3 et § 4 (ce que montre le panneau « Qui sont tes fans » et ce qui protège chaque fan).
Remplace : dans l'ADR 0065 § 2, les mots « avec au survol ou au toucher le nombre et la part de chaque case » (la part seule, § 8 ci-dessous).
Les ADR 0063 et 0065 restent telles quelles pour le reste ; les les mots « leur métier et leur ville ou région, tels qu'ils les ont dits » de l'ADR 0065 § 3 se lisent avec le § 4 et le § 5 ci-dessous (la région, jamais la ville ; des familles de métiers).

## Contexte

L'ADR 0065 a fixé le panneau « Qui sont tes fans » en tête de Ventes : les tranches d'âge (18–24, 25–34, 35–44, 45–54, 55 et plus) et la moyenne, les cinq métiers et les cinq lieux les plus cités, la situation, un seuil de 10 fans par chiffre et une case de moins de 3 fans rangée dans « Autres ». Elle laissait ouvert ce qu'elle nommait comme un risque : « Métiers et villes en texte libre : deux orthographes font deux cases tant qu'on ne les regroupe pas. »

Les faits viennent de la mémoire du fan (`fan_facts`), remplie par le KYC en conversation, avec des clés libres proposées par le modèle (`age`, `location`, `job`, `situation` pour les lignes du canevas, `KycSlotSchema`) et des valeurs telles qu'il les a écrites : « 28 », « j'ai 28 ans », « Lyon », « vers Annecy », « infirmier de nuit », « dans l'info ». Reveal ne donne rien de démographique (ADR 0018). Le 06/11 à 12h54, Charles lance le lot (« ok insights ») et veut un écran « très joli, des graphiques ou des donuts, de beaux hovers ».

Il reste donc à dire quels faits comptent, comment une valeur libre devient une case, où ce calcul se fait, et ce que voit la créatrice quand le seuil n'est pas atteint.

## Décision

1. **Les faits qui comptent.** Un fait compte s'il était actif à minuit (§ 2) : écrit avant, pas remplacé par un fait écrit avant (la date est le `created_at` du fait qui le remplace), et pas expiré à minuit (`expires_at`) ; il est aussi déclaré par le fan (`kind = 'declared'`), d'une autre catégorie que `operator_note` et `commercial`, et si sa clé, ramenée à sa forme normale (`Location` et `location` sont une clé), est `age`, `location`, `job` ou `situation`. Pour chaque fan et chaque clé, un seul fait compte : le plus récent par `observed_at` parmi ses faits qui comptent, quelle que soit sa catégorie (un fait est actif par catégorie et clé, et un fan peut avoir à la fois `identity:age` et `life:age`). Un fan dont l'âge est contesté (`ageDisputed`, un signe de mineur) ne compte dans aucun chiffre tiré de ses faits. Les fans sont ceux de tous ses comptes ; un même homme abonné à deux de ses comptes compte deux fois, comme dans « Tes fans ».

2. **Des chiffres arrêtés à minuit.** Les chiffres tirés des faits sont ceux de la veille à minuit, dans son fuseau (`creators.timezone`) : seuls comptent les fans et les faits écrits avant le début de sa journée. Un fan qui vient de dire son âge, ou qui le corrige, ne fait donc pas bouger une case sous ses yeux, ce qui le désignerait. Cela se lit sans colonne nouvelle : le fait qui en remplace un autre porte sa date.

3. **L'âge.** On lit le premier nombre entier de la valeur, écrit en chiffres (« 28 », « 28 ans ») ou en lettres (« vingt-huit ans »). Un âge en dehors de 18 à 99 ans, une fourchette (« entre 30 et 35 ») ou une approximation (« la trentaine ») ne se lit pas, et le fan ne compte pas dans l'âge. La moyenne est arrondie à l'année.

4. **Le lieu : la région, jamais la ville.** En France, une des 13 régions de la métropole, et « Outre-mer » pour tous les départements et régions d'outre-mer réunis. Hors de France, le pays. Une ville, un département (nom ou numéro) ou une région se reconnaissent par une table écrite dans le code ; la ville n'est jamais montrée, même quand elle est la plus citée. Ce qui ne se reconnaît pas va dans « Autres ».

5. **Le métier : une famille.** Chaque métier se range, par des mots-clés écrits dans le code, dans une de ces familles : Santé et soin · Enseignement et recherche · Informatique et ingénierie · Commerce et vente · Bureau, finance et droit · Bâtiment, artisanat et industrie · Transport et logistique · Hôtellerie et restauration · Sécurité, armée et fonction publique · Agriculture et environnement · Arts, médias et sport · À son compte · Étudiant · Retraité. Ce qui ne se reconnaît pas, dont « sans emploi », va dans « Autres ». Les cinq familles les plus citées s'affichent, le reste rejoint « Autres » (ADR 0065 § 3).

6. **La situation.** Célibataire · En couple · Marié · Séparé ou divorcé ; tout le reste (« c'est compliqué », « veuf », « libertin ») va dans « Autres ».

7. **Où et comment on range.** Le rangement est une fonction pure du domaine du module `fans`, côté serveur, appelée à la lecture sur la valeur telle qu'elle est en base. Ses tables (villes, départements, régions, pays, mots-clés des métiers et des situations) sont du code versionné, testé en unitaire, et grandissent par PR. Aucun modèle ne range une valeur (une case devinée par un modèle serait une déduction, et une règle métier ne vit pas dans un prompt), aucune colonne ni table n'est ajoutée, et le navigateur ne reçoit que des parts et des totaux arrondis, jamais une valeur écrite par un fan.

8. **Ce qu'elle voit : des parts, jamais le nombre d'une case.** Chaque bloc (âge, lieu, métier, situation) dit, arrondi à la dizaine, combien de ses fans ont donné l'information (« environ 40 de tes fans l'ont dit »), et ses parts portent sur ceux-là, arrondies à l'unité, leur somme faisant 100. Au survol ou au toucher d'une case, sa part seule (« 24 % »), jamais son nombre de fans ; il en va de même pour les autres cases du panneau (dépenses, jours et heures, ADR 0065 § 3). La réponse du serveur ne porte que ces parts et ce total arrondi, pas les comptes exacts, pour que l'écran ne puisse pas les montrer. Un bloc qui porte sur moins de 10 fans ne montre ni anneau ni nombre, seulement « Pas encore assez de fans pour le dire » (ADR 0065 § 4) ; la moyenne d'âge suit le même seuil.

9. **La réponse.** `GET /v1/creator-space/fan-insights`, lue sous RLS par le chemin de lecture de la créatrice (le filtre `kind = 'declared'` et les catégories sont dans la requête elle-même), déclarée au harnais d'isolation des routes, rend un contrat Zod `strict` (`packages/contracts`) fait de parts par case, de totaux arrondis et d'étiquettes fixes. Un champ de trop fait échouer le contrat, comme pour sa conversation (ADR 0063 § 3).

## Conséquences

Positives :
- « Lyon », « lyon » et « Villeurbanne » font une case (Auvergne-Rhône-Alpes), « infirmier » et « aide-soignante » aussi (Santé et soin) : le risque laissé ouvert par l'ADR 0065 est fermé.
- Changer une table ne demande ni migration ni reprise des données : la lecture suivante range autrement.
- Rien de ce qu'un fan a écrit ne quitte le serveur vers son écran.

Négatives, à surveiller :
- Une table ne connaît pas tout : un métier ou un lieu rare tombe dans « Autres ». Si « Autres » devient une grosse case, on enrichit les tables par PR, avec des valeurs inventées dans les tests (ADR 0010, dépôt public).
- Le seuil protège un fan contre les chiffres, pas contre la lecture de sa conversation, que la créatrice lit déjà (ADR 0063 § 3) : il évite que les chiffres deviennent une fiche par fan, rien de plus.
- Le recoupement d'un jour sur l'autre (un seul fan s'ajoute, une seule case gagne 1) est freiné par l'arrêt à minuit, les parts sans nombre et le total arrondi, sans être impossible : une part arrondie bouge aussi quand un fan arrive dans une petite base. Aucun bruit n'est ajouté, c'est un choix.
- Elle ne peut plus dire « 12 de mes fans sont infirmiers », seulement « un quart » : moins précis, voulu.
- « Déclaré » (`kind = 'declared'`) est le jugement du modèle qui extrait le fait, pas une preuve que le fan l'a dit ; une erreur d'extraction peut entrer dans les chiffres.
- Arrêter les chiffres à minuit les met un jour en retard ; c'est voulu.
- Un calcul à chaque lecture coûte une requête sur les faits actifs de ses fans. Si une base devient trop grosse pour cela, une photo quotidienne en table viendra par une ADR.

## Alternatives rejetées

- **Le modèle range la valeur quand il écrit le fait** (une colonne « tranche » remplie par l'IA) : une case devinée est une déduction, la règle passerait dans un prompt, et changer les cases obligerait à tout réécrire.
- **Une colonne normalisée écrite avec le fait** : une migration et une reprise des données à chaque changement de table, pour un gain qu'on n'a pas à cette taille.
- **La ville** : plus parlante, mais une petite ville identifie vite un fan ; la région suffit à « d'où viennent mes fans ».
- **Les cinq valeurs brutes les plus citées** (ADR 0065 telle qu'écrite) : deux orthographes font deux cases, et une valeur brute peut porter un détail qui désigne le fan.
- **Calculer dans le navigateur** : il recevrait les valeurs de chaque fan.
- **Des chiffres en direct** : un fan qui parle ferait bouger une case devant elle.
- **Le nombre exact au survol** (ADR 0065 § 2 telle qu'écrite) : il rend le recoupement d'un jour sur l'autre immédiat ; Charles a choisi les parts (« ok parts »).
- **Du bruit ajouté aux comptes** : trop lourd pour ce que c'est.
