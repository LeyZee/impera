# 2026-11-06 · SEC-05 lot 2 : lier son chat privé Telegram (ADR 0068 § 4)

- Fil : Bilan. Branche `claude/project-thread-a8l1w6`.
- Fait : un compte de l'agence (propriétaire ou équipe) demande un code à usage unique de 10 minutes, avec une connexion récente. Il l'envoie au bot de l'agence par `/start <code>` (lien `t.me/<bot>?start=<code>`). Le bot lie ce chat privé au compte et répond dans ce chat, que le code soit bon ou non. Seule l'empreinte SHA-256 du code est gardée ; un code est pris une seule fois ; un nouveau code remplace l'ancien ; délier supprime aussi le code en attente. Migration 0123 : `telegram_link_codes` et `telegram_private_links`, RLS forcée sans politique et retirées à `nirvana_app`. Audit `telegram_private_link.code/link/remove`, sans code ni chat.
- Tests : `private-link.integration` (sans bot, connexion récente, code rejoué ou expiré, remplacement, délier, audit, tables fermées au rôle applicatif) ; lecture de `/start` dans `infra.test` (privé seulement, `/start@bot`, rien d'autre du texte).
- Décisions : la liaison se fait avant que l'offset avance (une reprise relit un code déjà pris plutôt que de perdre la liaison) ; le bot qui prend les codes est le plus ancien bot actif ; routes sous `/v1/auth/telegram-link` pour le compte connecté, pas sous Réglages › Telegram, qui est réservé au propriétaire.
- Découvertes : aucune.
