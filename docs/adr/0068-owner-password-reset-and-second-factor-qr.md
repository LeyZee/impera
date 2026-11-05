# 0068. Mot de passe oublié du propriétaire et QR code de la validation en deux étapes

Statut : accepted (Charles, 05/11/2026, 18 h 13, « ok 0068 » ; canal choisi le 05/11/2026, 18 h 08, sur la carte du fil Bilan : « Les deux »)
Date : 2026-11-05
Précise : ADR 0016 (clés jamais dans le chat), ADR 0046 (deuxième facteur), ADR 0020 (bot Telegram de l'agence), EQ-10 (lien de réinitialisation d'un membre). Ne remplace rien.

## Contexte

- Un membre de l'équipe qui oublie son mot de passe reçoit un lien de réinitialisation que le propriétaire génère (EQ-10). Le propriétaire, lui, n'a aucun recours dans le CRM : il ne lui reste que le terminal, contraire à sa règle (« tout depuis le CRM »).
- L'écran d'activation de la validation en deux étapes montre la clé à recopier et un lien `otpauth`, sans QR code : il faut taper la clé dans l'application d'authentification.
- Le CRM n'envoie encore aucun e-mail. Le bot Telegram de l'agence écrit seulement dans des groupes, jamais en privé.

## Décision

1. **QR code dessiné sur place.** L'écran d'activation dessine le QR de l'adresse `otpauth`, à côté de la clé à recopier. Le dessin se fait dans le navigateur, par un encodeur écrit dans le dépôt, ou par une bibliothèque ancienne et éprouvée soumise à la quarantaine de 14 jours. Jamais d'appel à un service externe, parce que le QR contient le secret. Le QR disparaît dès que l'activation est confirmée.
2. **« Mot de passe oublié » sur la page de connexion.** La personne saisit son e-mail ; la réponse est toujours la même phrase, que le compte existe ou non, et prend le même temps. Une demande au plus par compte toutes les 5 minutes, et une limite par adresse IP.
3. **Le lien.** C'est le lien `reset` d'EQ-10 : usage unique, valable 15 minutes, seule son empreinte est gardée. Le nouveau mot de passe ferme toutes les sessions du compte. Le code à 6 chiffres reste demandé à la connexion suivante : le lien remplace le mot de passe, jamais le deuxième facteur.
4. **Canaux, dans cet ordre.**
   - **Telegram, tout de suite.** Le bot de l'agence envoie le lien en message privé au compte Telegram que le propriétaire a lié avant. La liaison se fait depuis Réglages › Telegram, connexion récente exigée : le CRM affiche un code à usage unique (10 minutes) à envoyer au bot par `/start <code>` ; le bot garde l'identifiant de ce chat privé, sous le rôle admin, et ne l'utilise que pour ce lien. Le message dit seulement qu'une réinitialisation a été demandée et donne le lien, jamais un montant, un nom de créatrice ou une clé.
   - **E-mail, quand un service d'envoi sera branché.** Sa clé se saisit dans le CRM comme les autres (ADR 0016) ; le lien part alors aussi à l'adresse du compte. Le choix du service est une décision à part.
   - Sans canal lié, la page dit de demander à un autre propriétaire ou, en dernier recours, d'utiliser la commande ops ; aucune autre voie n'est ouverte.
5. **Qui.** Ce parcours vaut pour le propriétaire et pour les membres de l'équipe qui ont lié Telegram ; une créatrice garde le parcours de son espace. Chaque demande, envoi et réinitialisation va au journal d'audit, sans le lien.

## Conséquences

- Le propriétaire peut retrouver l'accès sans terminal, à condition d'avoir lié son Telegram avant.
- Le bot gagne un chat privé, limité à ce seul usage.
- L'e-mail reste à brancher : un compte chez un service d'envoi et une clé de plus.

## Alternatives écartées

- **Questions secrètes** : faibles et devinables.
- **Lien affiché sans canal** : n'importe qui connaissant l'e-mail prendrait le compte.
- **QR par un service en ligne** : le secret sortirait du CRM.
