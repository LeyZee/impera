# Bot du canal Telegram

Telegram ne sert plus qu'au canal de chaque créatrice (ADR 0080, ADR 0176) : un bot y publie ses posts à leurs créneaux. Les alertes de l'agence ne passent plus par Telegram : voir `alerts.md`.

## Un post ne part plus

1. Réglages › Bots Telegram : l'état du bot dit la cause, en une phrase.
2. « Jeton refusé » : le jeton a été révoqué. Dans @BotFather, `/token` pour en obtenir un, puis « Remplacer le jeton ».
3. « Utilisé ailleurs » : un autre programme lit le même bot. L'arrêter, ou créer un bot réservé à Impera.
4. Le bot n'est plus administrateur du canal : l'y rajouter avec le droit de publier, puis relire sa fiche (Créatrices › Canal Telegram).

## Jeton fuité

Révoquer d'abord dans @BotFather (`/revoke`), puis coller le nouveau jeton dans « Remplacer le jeton ». Le jeton n'est jamais dans un journal ni dans l'extension ; il est chiffré en base (`CREDENTIALS_ENCRYPTION_KEYS`, voir `rotate-secrets.md`).
