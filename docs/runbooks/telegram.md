# Notifications Telegram

Les groupes Telegram reçoivent ce qui demande un humain (ADR 0020). Un message ne contient jamais le texte d'un fan : il dit quoi, pour quelle créatrice, et donne un lien vers le CRM.

## À la réception

| Message | Que faire |
|---|---|
| 🔴 **URGENT** (mineur possible, non-consentement, détresse, rencontre, manipulation) | Ouvrir le lien tout de suite. L'agent n'écrit plus à ce fan. Prendre la conversation (« Reprendre la main ») : le message passe « ✓ Pris en main par … » pour le reste du groupe. Mineur ou non-consentement : ne rien envoyer, prévenir Charles. |
| 🟠 **Important**, passage à l'humain | Ouvrir le lien quand possible ; l'agent attend un humain pour ce fan. |
| 🟠 **Important**, plafond IA | À 16 € : rien à faire, surveiller. Atteint : plus de génération jusqu'à minuit, les chatteurs reprennent. |
| 🟠 **Important**, session Reveal expirée | Suivre `session-expired.md`. Le groupe reçoit « Résolu » au retour de la session. |
| 🟠 **Important**, agent arrêté | Quelqu'un a tiré l'interrupteur d'arrêt ; la raison est dans le message. « Résolu » quand il est relâché. |
| 🔵 Bilan du matin | Rien à faire. |

## Quand plus rien n'arrive

1. Réglages › Telegram › Bots et groupes : l'état du bot et du groupe dit la cause, en une phrase.
2. « Jeton refusé » : le jeton a été révoqué. Dans @BotFather, `/token` pour en obtenir un, puis « Remplacer le jeton ». Les messages en attente partent dans l'heure qui suit.
3. « Utilisé ailleurs » : un autre programme lit le même bot. L'arrêter, ou créer un bot réservé à Impera.
4. « Le bot ne peut plus écrire dans ce groupe » : le rajouter au groupe, puis « Envoyer un test ».
5. Bandeau « Personne n'est prévenu la nuit » : onglet Alertes, choisir un groupe pour l'urgent.

## Jeton fuité

Révoquer d'abord dans @BotFather (`/revoke`), puis coller le nouveau jeton dans « Remplacer le jeton ». Le jeton n'est jamais dans un journal ni dans l'extension ; il est chiffré en base (`CREDENTIALS_ENCRYPTION_KEYS`, voir `rotate-secrets.md`).
