# 0165. « Où te verser » : le membre écrit où il est payé, scellé, et seul le propriétaire le lit

Statut : proposed
Date : 2026-11-21
Complète : l'ADR 0023 § Factures (les coordonnées de paiement y étaient hors périmètre, EQ-06 et EQ-14), l'ADR 0016 § 3 (le scellement des secrets).

## Contexte

Le propriétaire verse chaque relevé par WorldRemit (`PAYMENT_METHODS`, choix de Charles du 28/10). Pour envoyer, il lui faut le nom du bénéficiaire, la façon dont il reçoit (mobile money, compte bancaire, retrait en espèces) et le numéro qui va avec. Aujourd'hui ces coordonnées vivent hors d'Impera, dans un message ou une note : rien ne dit qu'elles sont à jour, ni qui les a changées. La grande recette du 21/11 l'a relevé (trou n° 5).

Ce sont des données personnelles et un vecteur de fraude classique : qui change le numéro détourne le versement. Le dépôt est public : aucune vraie coordonnée n'y entre, ni dans les tests.

## Décision

1. **Ce qui est gardé**, une ligne par version, en ajout seul (`payout_destinations`) : la façon de recevoir, en clair (`mobile_money`, `bank_account`, `cash_pickup`), et dans un seul bloc scellé le nom du bénéficiaire, le numéro (téléphone mobile money avec son opérateur, IBAN ou numéro de compte avec sa banque ; rien pour un retrait, sinon la ville) et une note libre courte. La version la plus récente est celle qui vaut ; les anciennes restent pour savoir qui a changé quoi et quand.
2. **Scellé** avec `CREDENTIALS_ENCRYPTION_KEYS`, comme les clés des services IA (ADR 0016 § 3), contexte `payout_destination:<membre>:<version>` : un bloc recopié sur un autre membre, ou une ancienne version rejouée comme courante, ne s'ouvre pas. Sans clé configurée, rien n'est gardé et la route le dit (`payout_destination_unavailable`). Le changement de clé ne modifie jamais une ligne : il ajoute une version au même contenu, scellée avec la nouvelle clé et marquée « re-scellée » (ni notification ni ambre).
3. **Qui écrit** : le membre lui-même, sur sa propre fiche, avec un mot de passe et un code donnés depuis moins de 10 minutes (ADR 0046 § 3), comme le reste de son dossier. Jamais le propriétaire ni un manager pour lui : un versement ne se détourne pas depuis un autre compte.
4. **Qui lit** : le membre la sienne, et le propriétaire, à côté de « Marquer payé ». Le propriétaire ne lit jamais les numéros en liste : la liste dit la façon de recevoir et la date du dernier changement ; le nom et le numéro se révèlent un membre à la fois, avec une connexion récente, et chaque révélation va au journal (qui, quel membre, jamais la valeur). Un manager ne la lit pas, même pour un membre de son équipe. Le rôle de service ne lit pas la table, dérogation voulue à la recette des tables nouvelles (avis de Sécurité du 21/11). La base le redit (FORCE RLS, politiques de lecture par le propriétaire ou soi, d'ajout par soi, déclencheur qui refuse toute modification et suppression). Le clair ne sort nulle part ailleurs : ni journaux, ni rapport d'erreurs, ni export, ni outil, ni prompt ; les réponses portent `Cache-Control: no-store`.
5. **Un changement se voit** : `audit_log` garde `payout_destination.update` avec la façon de recevoir et une empreinte de 8 caractères du bloc scellé (jamais du clair, qu'une force brute retrouverait), jamais le nom ni le numéro. Le membre reçoit une notification « Où te verser a changé » sur chacun de ses appareils, après un changement réussi seulement. Au plus 3 changements par jour et par membre. Le propriétaire voit, à côté de « Marquer payé », la date du dernier changement, en ambre s'il a moins de 7 jours.
6. **Un membre parti** garde la lecture et l'écriture de sa propre destination tant que son espace de départ est ouvert (EQ-14) : son dernier relevé doit pouvoir lui parvenir.

## Conséquences

- Positives : le propriétaire paie depuis Impera sans chercher un numéro ailleurs ; un changement est daté, attribué et signalé.
- Négatives : un chatteur qui n'arrive pas à remplir sa destination bloque son propre versement ; le propriétaire ne peut pas la saisir pour lui (choix voulu, point 3).
- À surveiller : la liste des façons de recevoir suit WorldRemit ; une façon nouvelle est une migration du `check`, jamais du texte libre.

## Alternatives rejetées

- **Le propriétaire saisit les coordonnées** : plus simple pour un chatteur peu à l'aise, mais un compte propriétaire volé détournerait tous les versements sans qu'aucun membre ne le voie.
- **Colonnes en clair protégées par la RLS seule** : une sauvegarde ou une copie de la base les donnerait toutes.
- **Dans `contractor_profiles`** : chaque champ y est d'identité et fait tomber la vérification du propriétaire ; un numéro de téléphone qui change ne change pas qui facture.
