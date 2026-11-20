# 0096. Un compte propriétaire de secours

Statut : accepted (« ok 0096 » de Charles le 12/11/2026, 23 h 18) ; rédigée par le fil « Trouver les trous de pilotage d'agence » ; « applique tout » de Charles du 12/11/2026, 23 h 11)
Date : 2026-11-12
Précise : 0024 (rôles), 0046 et 0068 (second facteur, réinitialisation du propriétaire). Ne remplace rien.

## Contexte

Réglages, Entraîner, le passage en Automatique et le marquage « payé » n'appartiennent qu'au propriétaire. Un seul compte le porte. S'il est injoignable ou perd son téléphone, l'agence tourne en mode dégradé, et la seule voie de secours est une commande sur le serveur.

## Décision

1. **Deux propriétaires au plus.** Le propriétaire peut faire d'un compte invité un second propriétaire (son associé), avec son mot de passe et son code 2FA. Pas de troisième.
2. **Mêmes droits, sauf un.** Le second propriétaire a tous les droits du premier, sauf retirer le premier : un propriétaire ne peut en retirer un autre qu'après 72 h de préavis, annoncé aux deux par Telegram et par une notification d’Impera (Impera n’envoie pas d’e-mail), et annulable par le visé. Cela empêche un vol de compte de verrouiller l'agence en silence.
3. **2FA obligatoire** dès la première connexion (0046), clé d'accès conseillée.
4. **Tout se journalise** (EQ-18) : création, retrait, et chaque geste d'argent ou d'accès porte le nom du propriétaire qui l'a fait.
5. **Alerte** de sécurité à l'autre propriétaire à chaque nouvelle connexion d'un propriétaire sur un nouvel appareil.

## Conséquences

- Positives : l'agence ne dépend plus d'un seul téléphone.
- Négatives : deux comptes aux pleins pouvoirs doublent la surface d'attaque ; d'où le préavis et les alertes.

## Alternatives rejetées

- Délégation temporaire à un manager : plus complexe (droits partiels, durée), et un manager n'est pas toujours un associé.
- Rien : la commande serveur suppose un développeur disponible.

## Qui code quoi (pour le coordinateur)

Bilan (auth), relecture par le fil de l'audit de sécurité.
