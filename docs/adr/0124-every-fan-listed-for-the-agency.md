# 0124. Tous les fans d'une créatrice, listés pour l'agence

Statut : accepted (acceptée par Charles le 16/11/2026 : « ok 0124 » ; demande de Charles du 16/11/2026 : « c'est pas que les fans qui comptent, c'est nommer tous les fans » ; choix « la liste d'abord, l'import pour l'IA ensuite, en deux chantiers séparés » du même jour ; numéro attribué par le coordinateur)
Date : 2026-11-16
Précise : 0092 § 3 (les fans qui comptent, nommés pour l'agence), 0078 (insights du registre), 0024 (rôles), 0025 (lecture tracée d'un chatteur), 0043 § 7, 0063 (ce que voit la créatrice). Ne remplace rien.

> Cette ADR ne contient aucune donnée réelle : ni pseudo, ni montant, ni créatrice.

## Contexte

L'ADR 0092 § 3 nomme trois listes de payeurs (les plus gros, ceux qui ont décroché, ceux communs à plusieurs créatrices). Elles ne sont pas codées (recette du 16/11, REG-23). Charles demande plus large : voir tous les fans d'une créatrice, pas seulement ceux qui paient beaucoup. Aujourd'hui un fan ne se trouve que par sa conversation dans Suivi, et la vue agence ne donne que des nombres.

Faire connaître d'un coup à l'agent les fans que Reveal connaît déjà, sans leur écrire, est un autre chantier (ADR 0127, réservée). Ici, rien ne change pour l'agent.

## Décision

1. **Un écran « Fans ».** Une ligne par fan connu du CRM pour une créatrice (table `fans`) : pseudo, premier contact, dernier message de lui, dernier paiement, payé sur la période et depuis toujours (registre), qui tient sa conversation (agent ou membre). Ses états s'affichent en pastilles, avec les mots de Suivi : « Ne plus lui écrire », âge contesté, mode soin, ventes gelées. Chaque ligne ouvre sa conversation dans Suivi.
2. **Les listes de 0092 § 3 deviennent des filtres de cet écran** : « Gros payeurs » (les plus gros de la période), « Ont décroché » (ont payé avant, plus rien depuis N jours, 21 par défaut, réglable), « Communs à plusieurs créatrices » (même identifiant chez la plateforme). S'y ajoutent « Payeurs », « N'ont jamais payé » et « Sans réponse de nous ». La vue agence garde un résumé de chaque liste, qui mène ici.
3. **Chercher et trier.** Recherche par pseudo, sans tenir compte des accents ni de la casse (la même règle que Suivi). Tri par payé, dernier message, dernier paiement. Pagination par clé : une créatrice peut avoir des dizaines de milliers de fans.
4. **Qui voit.** Le propriétaire, un manager actif pour les créatrices de sa liste (0078 § 1). Un chatteur ne voit pas l'écran : il retrouve ses fans dans Suivi, avec la lecture tracée de 0025. La créatrice ne le voit jamais (0063).
5. **Ce qui s'affiche, et pas plus.** Le pseudo et des chiffres, jamais un contenu de message ni la fiche du fan : la fiche se lit dans Suivi, avec ses droits.
6. **Lecture seule, aucune action automatique.** L'écran n'écrit rien, ni chez nous ni dans Reveal. L'agent ne le lit pas et n'écrit à personne parce qu'il figure dans une liste.
7. **Les fans que le CRM ne connaît pas encore** (ceux qui n'ont pas écrit depuis le branchement de Reveal) n'y sont pas. L'écran le dit en une ligne tant que l'import de l'ADR 0127 n'existe pas.

## Conséquences

- Positives : le directeur nomme et retrouve n'importe quel fan, et agit sur ceux qui comptent.
- Négatives : les sommes par fan sur le registre demandent un index (une migration, numéro au coordinateur) ; un pseudo de fan s'affiche à un endroit de plus, avec les mêmes droits que la vue agence de 0092.
- À surveiller : « communs à plusieurs créatrices » n'est juste que si la plateforme donne le même identifiant de fan d'un compte à l'autre ; sinon le filtre est masqué et l'écran le dit.
- Partage : la route et la lecture chez Agent (module `fans`, registre lu par son port), l'écran chez Design.

## Alternatives rejetées

- Garder seulement les trois listes de 0092 § 3 : Charles veut tous les fans.
- Montrer l'écran aux chatteurs : contraire à 0043 § 7 et 0025 ; Suivi leur suffit.
- Importer ici les fans de Reveal : c'est l'ADR 0127, qui touche le connecteur et l'agent.
