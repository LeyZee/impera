# 0117. L'agent écrit le prénom du membre et le canevas de la note client

Statut : accepted (« ok 0117 » de Charles le 16/11/2026, 01 h 03 heure de Paris ; demande de Charles du 15/11/2026 : « que l'IA puisse mettre à jour le prénom du membre dès qu'elle a le nom […] et pouvoir remplir les notes pour aider les chatteurs » ; numéro attribué par le coordinateur le 15/11)
Date : 2026-11-15
Précise : ADR 0018 § 1 (la note client reste lue en direct, jamais copiée) et ADR 0085 § 11 (l'écriture dans la note client attendait une ADR à part). Ne remplace rien.

## Contexte

Sur Reveal, le panneau Analytics d'une conversation porte deux champs que les chatteurs remplissent à la main :

- **Prénom du membre** : un champ dédié, source de la variable `%NAME%` des étapes de script et des Mass DM. Un prénom vide ou faux part tel quel dans chaque Mass DM.
- **Notes** (note client) : un texte libre, structuré par le canevas de l'agence (Prénom, Localisation, Âge, Métier, Passions, Envies, Situation).

L'agent apprend déjà ces informations en parlant au fan : elles vivent dans sa fiche (`fan_facts`, ADR 0085), avec leur source (« dit par lui », « deviné », « noté par un chatteur »). Elles ne remontent pas dans Reveal, donc un chatteur qui reprend la conversation ne les voit pas, et `%NAME%` reste vide.

Ce que le code sait faire aujourd'hui (main au 15/11) :

- **Note client** : lecture et écriture observées (`PATCH /conversations/:id/note { note }`, qui remplace la note entière, sans numéro de version). `RevealApiConnector.setFanNote` relit la note juste avant d'écrire et ne réécrit que les lignes du canevas (`withAgencyBlock`), toutes les autres lignes restent mot pour mot. L'écriture passe par la garde d'écriture (`outbound-sender.ts`). **Rien ne l'appelle.**
- **Prénom du membre** : lu (`conversation.memberFirstname`), utilisé comme nom affiché. **Son écriture n'a jamais été observée.**

## Décision

Choix de Charles du 15/11 (cartes de décision et message) : l'agent écrit **seul**, sans clic humain ; le prénom n'est écrit **que s'il l'a dit lui-même** ; une ligne écrite par un chatteur reste, mais l'agent peut la préciser, ou la corriger quand les échanges récents la contredisent nettement (« l'idée, c'est que ça fasse gagner du temps au chatteur »).

1. **L'agent écrit seul, et tout passe par la garde d'écriture.** Dès qu'une valeur de la fiche change (§ 4), un job met Reveal à jour. Aucun clic d'un chatteur n'est demandé. La garde d'écriture du compte (`connector_config.writes`, ADR 0018 § 3) reste le seul interrupteur : fermée, rien ne part. Chaque écriture entre au journal (champ, ligne, source de la valeur), jamais avec la valeur ni le texte de la note.

2. **Le prénom du membre : seulement s'il l'a dit, seulement si le champ est vide.**
   - La seule source est un fait `first_name` actif de source « dit par lui » (`declared`) ou « noté par un chatteur » (`noted`). Un prénom deviné (`inferred`, tiré d'un pseudo ou d'une signature) n'est jamais écrit.
   - L'agent n'écrit que dans un champ vide. Un prénom déjà présent, quel que soit son auteur, n'est jamais remplacé.
   - S'il donne plus tard un autre prénom, l'agent ne change rien dans Reveal : il le signale au chatteur dans le panneau copilote (« il a dit s'appeler X, Reveal dit Y »). Le changement reste un geste humain.
   - Garde en code avant l'écriture : une à deux parties de lettres Unicode (`\p{L}`, un prénom accentué passe ; tirets et apostrophes permis), 30 caractères au plus, rien de ce que la fiche ne garde jamais (`neverKept`, ADR 0085 § 8). Une valeur refusée n'est pas écrite et n'est pas signalée au fan.

3. **La note client : la ligne d'un chatteur reste, l'agent la précise ou la corrige seulement sur la parole du fan.**
   - Une ligne vide (libellé seul ou absent) ou écrite par l'agent lui-même est remplie et tenue à jour librement.
   - Pour savoir qu'une ligne est la sienne, Impera garde, par compte, fan et ligne, une marque à clé de la dernière ligne qu'il a écrite (HMAC-SHA-256, clé dérivée des clés de session du serveur et du compte, jamais en base), jamais la ligne elle-même (ADR 0018 § 1 : le contenu de la note n'est pas stocké). Une empreinte simple ne suffit pas : une ligne aussi courte que « Âge : 25 » se retrouverait en essayant les valeurs. Une ligne qui n'a plus cette marque a été écrite par un humain.
   - **Préciser** une ligne d'un humain : l'agent ajoute à la fin ce qui manque, sans rien effacer (une passion de plus, « Lyon » devient « Lyon, Croix-Rousse »). Seulement avec une valeur « dit par lui ».
   - **Corriger** une ligne d'un humain : seulement si le fan a dit lui-même, dans un message des 7 derniers jours, une valeur qui contredit nettement la ligne (autre ville, autre âge, autre métier). Une valeur devinée ne corrige jamais. L'ancienne valeur reste visible sur la même ligne, dans Reveal : « Localisation : Paris (avant : Lyon) », pour que le chatteur voie le changement et puisse revenir dessus.
   - Une ligne qu'un chatteur a modifiée après une correction de l'agent n'est plus corrigée ; l'agent la précise encore, rien de plus.
   - Le « (avant : …) » d'une correction n'est jamais retiré par l'agent : il reste tant qu'un humain ne l'a pas enlevé, et l'agent ne réécrit pas une ligne qu'il a corrigée.
   - Toutes les autres lignes de la note (hors canevas) restent mot pour mot, comme aujourd'hui.

4. **Ce qui va dans la note.** Une ligne reçoit la valeur active de la case de même code dans la fiche, si sa source est « dit par lui » ou « noté par un chatteur » dans le CRM. Une valeur devinée reste dans la fiche d'Impera et n'entre pas dans Reveal. La ligne Envies suit la même règle (elle n'est jamais demandée au fan, ADR 0085 § 2, mais peut avoir été dite). Une liste s'écrit comme la fiche l'affiche, séparée par des virgules. Ce qui est exclu de la fiche (§ 8 de l'ADR 0085) n'est jamais écrit. Tant que l'âge du fan est contesté, la ligne Âge n'est ni remplie, ni complétée, ni corrigée : un humain tranche. La note n'est jamais relue vers la fiche : si elle l'est un jour, une ligne qui porte la marque de l'agent est ignorée, pour qu'une valeur ne revienne pas sous la source « noté par un chatteur » (qui confirme l'âge).

5. **Quand.** Un job par conversation (`connectors.sync_fan_platform_fields`), mis en file après chaque écriture de faits du fan, avec un délai de regroupement de 2 minutes et une seule exécution à la fois par conversation (ADR 0006). Il relit la note et le prénom juste avant d'écrire, calcule ce qui manque, et n'écrit rien quand Reveal dit déjà la même chose. Clé d'idempotence : marque à clé du bloc écrit. Le job est rejouable.

6. **Port connecteur.** Une méthode optionnelle `setFanFirstName?(fanRef, value, key)` s'ajoute au port, annoncée par une capacité `fanFirstNameWrite`, avec les règles de l'ADR 0018 § 1 (erreurs typées, clé d'idempotence, garde d'écriture au même point d'entrée). Le cœur ne connaît ni Reveal ni `%NAME%`. `setFanNote` ne change pas. La capacité est déclarée partout où `ConnectorCapabilities` est construit (`FakeConnector` : non ; FakeReveal : oui), avec le test de contrat qui vérifie la méthode selon le drapeau.

7. **Ordre de livraison.**
   - Lot a (sans capture) : § 3, 4, 5 pour la note client, tests contre `FakeReveal`, migration de la table des marques.
   - Lot b (après la capture) : § 2 et § 6 pour le prénom. La capture se fait sur le compte fan test seul, avec l'accord écrit de Charles : le prénom est modifié puis remis comme avant. On y vérifie aussi ce que devient `%NAME%` quand le prénom est vide.
   - Aucune écriture sur un compte réel avant que Charles ouvre la garde d'écriture de ce compte.

## Conséquences

Positives :

- Les chatteurs trouvent dans Reveal ce que l'agent a appris, sans changer d'outil.
- `%NAME%` se remplit pour les Mass DM, sans risque de faux prénom deviné.
- Un chatteur garde la main : ce qu'il a écrit n'est jamais effacé sans trace, et il a le dernier mot sur une ligne déjà corrigée.

Négatives :

- La ligne « (avant : …) » alourdit la note ; un chatteur la nettoie quand il a vérifié.
- Reveal n'a pas de numéro de version : si un chatteur écrit pendant les quelques millisecondes entre la relecture et l'écriture, sa modification peut se perdre. Le risque est accepté, comme pour P2-03.

À surveiller :

- La forme de l'écriture du prénom chez Reveal (capture du lot b).
- Les signalements « Reveal dit autre chose » : s'ils sont nombreux, la règle du § 2 est à revoir avec Charles.
- Une rotation des clés de session : une marque d'une clé retirée ne se lit plus, les lignes de l'agent passent pour humaines et ne sont plus que complétées (le côté sûr). Garder l'ancienne clé le temps que les notes soient réécrites.

## Alternatives rejetées

- **Proposer chaque ligne au chatteur, qui valide d'un clic** : choix de Charles du 15/11, l'agent écrit seul.
- **Écrire aussi un prénom deviné** ou **remplacer le prénom par le dernier dit** : un faux prénom part dans tous les Mass DM (choix de Charles du 15/11).
- **Copier la note client chez nous pour savoir qui a écrit quoi**, ou pour garder l'ancienne valeur d'un chatteur : contraire à l'ADR 0018 § 1 ; une marque à clé suffit, et l'ancienne valeur reste dans la note elle-même.
- **Une empreinte SHA-256 simple de chaque ligne** : une ligne courte se retrouve en essayant les valeurs, l'empreinte vaudrait presque une copie (relecture de Bilan, #775).
- **Ne jamais toucher une ligne d'un chatteur** : Charles veut que l'agent fasse gagner du temps, y compris en corrigeant une erreur nette (15/11).
- **Écrire les valeurs devinées dans Reveal** : un chatteur ne verrait pas qu'elles sont des hypothèses, la fiche d'Impera le montre déjà.
