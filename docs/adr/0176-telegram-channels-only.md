# 0176. Telegram ne sert plus qu'aux canaux des créatrices ; les alertes passent par les notifications d'Impera

Statut : accepted (avenant du 27/11/2026, audit des contradictions : le code a été fusionné par la PR #1052 le 27/11, migration 0286, sur la décision de Charles citée ici ; la décision passe donc de « proposée » à « acceptée ») — décision de Charles du 27/11/2026, 00 h 31 : « les seuls trucs sur Telegram que j'ai envie de faire, c'est uniquement pour gérer le canal Telegram des modèles […] tout ce qui est en dehors de ça, on peut supprimer Telegram » ; 00 h 35 : les alertes urgentes de nuit par « notification Impera plus relance » ; confirmée le 27/11/2026 à 01 h 13 dans le fil « Remettre la documentation au propre » : « j'ai déjà tranché, ça sert plus à rien »)
Date : 2026-11-27
Remplace : 0020 (notifications Telegram).
Amende, en place et datées du 27/11/2026 : 0046 § 8 (alertes de sécurité), 0059 (écarts de persona), 0068 (mot de passe oublié), 0080 (aperçu des posts), 0088 § 5 (rappel au bout d'une heure), 0150 (alertes de chaque créatrice).

## Contexte

1. Telegram est entré dans Impera pour prévenir l'agence la nuit (0020) : un bot, des groupes, un routage `urgent` / `important` / `info`, une trentaine d'événements (passages à l'humain, ventes, dépense IA, session Reveal, factures, sauvegardes, sécurité), un récap du matin, un bilan du soir.
2. Il a ensuite servi à deux autres choses : le chat privé de chaque compte, qui recevait le lien du « mot de passe oublié » (0068), et le canal de chaque créatrice (0080).
3. L'application installée a depuis ses notifications (module `notifications`, 0042 § 7) : appareils, heures calmes, plafond du jour, « Tes notifications », et un motif qui passe la nuit (`safety_alert`, 0150 § 6).
4. Charles ne garde qu'un usage de Telegram : gérer le canal de chaque créatrice et ses publications. Son agent IA, branché plus tard sur Impera, lui fera les récaps.

## Décision

### 1. Ce qui reste sur Telegram

Le bot qui publie (`telegram_bots`), la liste des canaux où il est (`telegram_chats`), Créatrices › Canal Telegram, les posts, sondages et créneaux, le playground « Post du canal », les liens de redirection (0121). Réglages › Bots Telegram ne sert plus qu'à brancher un bot sur un canal : trois étapes (créer le bot, coller le jeton, l'ajouter au canal). Le module `telegram` ne garde que cela.

L'IA ne renvoie toujours jamais un fan de Reveal vers Telegram.

### 2. Ce qui part du code et des écrans

Le routage d'alertes vers des groupes, le scan de l'outbox, les envois groupés, le récap du matin, le bilan du soir, les rappels de panne toutes les deux heures, l'escalade vers l'autre propriétaire au bout de 15 minutes, les réglages de ventes sur Telegram, le chat privé par compte, les onglets Groupes, Routage et Envois de Réglages › Telegram, le bandeau « Personne n'est prévenu la nuit » du Dashboard, les lignes Telegram de Réglages › Alertes.

### 3. Les alertes de l'agence passent par les notifications d'Impera

- Ce que les groupes entendaient sonne sur les appareils des **propriétaires**, par le module `notifications` (job `alerts.agency`, chaque minute). Rien de ce que le fan a écrit, jamais son nom : le genre de l'événement, sa cause et l'écran à ouvrir.
- **Urgent** (motif `agency_urgent`) : passe les heures calmes et le plafond du jour. Ce sont les alertes de sécurité (§ 4) et le quota IA épuisé.
- **Le reste** (motif `agency_alert`) : passe hors plafond, attend la fin des heures calmes. Dépense IA, session Reveal, factures, sauvegardes, ventes, pannes.
- **Les relais de sécurité d'une créatrice** (mineur possible, non-consentement, détresse, rencontre, manipulation) restent ceux de son onglet Alertes (0150) : motif `safety_alert`, aux propriétaires, à ses managers et aux chatteurs en shift sur elle.
- **Relance** (job `alerts.remind_safety`, chaque minute) : un relais de sécurité que personne n'a pris (ni prise en main ni fin de prise en main) sonne de nouveau toutes les 5 minutes, pendant une heure au plus, chez les mêmes personnes.
- L'escalade vers l'autre propriétaire disparaît : tous les propriétaires sont prévenus dès la première minute.
- Les rappels de panne toutes les deux heures disparaissent : la panne sonne une fois, le Dashboard la montre tant qu'elle dure.

### 4. Alertes de sécurité (amende 0046 § 8)

Nouvel appareil, refus de connexion répétés, deuxième facteur remis à zéro, clé d'accès ajoutée, propriétaire ajouté ou retiré, persona activée, Automatique allumé, session Reveal remplacée : elles sonnent en `agency_urgent` chez chaque propriétaire, avec les mêmes mots que sur Telegram (l'acte, le rôle du compte, son réseau, jamais un nom ni une adresse complète). Le réseau de connexion (`203.0.113.x`) se lit donc sur l'écran verrouillé du téléphone d'un propriétaire : accepté (relecture Sécurité du 27/11), seuls les propriétaires les reçoivent.

### 5. Écarts de persona d'un chatteur (amende 0059)

Les interdits graves partiront en notification aux propriétaires (`agency_urgent` pour `explicit_before_age` et `meeting_promise`, `agency_alert` pour les autres), au lieu de Telegram. Le bilan du soir des écarts devient une lecture que l'agent IA de Charles vient chercher (§ 7). Ni l'un ni l'autre n'était encore codé : le lot qui les code suit ce paragraphe.

### 6. Fan en détresse (amende 0088 § 5)

« L'alerte Telegram urgente est renvoyée une fois au bout d'une heure » devient : le relais de détresse sonne de nouveau toutes les 5 minutes pendant une heure tant que personne ne l'a pris (§ 3). Rien ne part toujours sans validation.

### 7. Les récaps passent à l'agent IA de Charles

Le récap du matin, le bilan du soir et les bilans donnés aux chatteurs deviendront des lectures du serveur MCP d'Impera, en lecture seule, que son agent vient chercher à son rythme (Charles, 27/11 : « qu'il soit mes yeux et mes oreilles »). L'agent n'est pas un canal d'urgence : Impera ne peut pas le réveiller, c'est lui qui vient lire. Outils et droits : lot « connexion par compte », après le VPS.

### 8. Mot de passe oublié (amende 0068)

- La page « Mot de passe oublié » ne demande plus rien : sans lien, elle dit d'où il vient.
- Un membre de l'équipe ou une créatrice : un lien à usage unique fait par un propriétaire depuis Équipe (EQ-10), comme aujourd'hui.
- Un propriétaire : un lien fait sur le serveur par `pnpm ops:password-reset-link --email <e-mail>`, affiché là et jamais envoyé ailleurs, inscrit au journal d'audit sans adresse IP. Elle se lance dans un terminal interactif, jamais dans une tâche dont l'hébergeur garde le journal. Même lien que celui de 0068 : 15 minutes, un toutes les 5 minutes au plus, toutes les sessions fermées après usage, le deuxième facteur inchangé.
- L'envoi par e-mail viendra avec le domaine.

### 9. Aperçu des posts du canal (amende 0080)

L'aperçu d'un post, une heure avant son créneau, part en notification Impera (`agency_alert`) au lieu du groupe « Info ». Codé dans le lot du canal (« Publier sur Telegram à sa place »).

### 10. Alertes de chaque créatrice (amende 0150)

L'onglet Alertes ne renvoie plus vers des groupes Telegram. La case d'une alerte personnalisée devient « Prévenir l'équipe » : cochée, elle sonne en notification ; décochée, elle reste dans l'historique du Suivi, sans notification.

### 11. Base

Les tables qui ne servent plus (`telegram_routes`, `telegram_deliveries`, `telegram_settings`, les liens et codes du chat privé, l'état du scan) restent en place, plus lues ni écrites. Leur suppression est une migration à part, sur le mot écrit de Charles. La migration de ce lot change seulement la contrainte des motifs de notification et retire le déclencheur du scan.

### 12. Mise en route

L'étape « groupe Telegram » de la Mise en route devient « Alertes de nuit » : faite quand un propriétaire a au moins un appareil qui reçoit les notifications.

## Conséquences

- Un seul canal d'alerte à tenir : celui de l'app, que toute l'équipe a déjà.
- Sur iPhone, une alerte de nuit exige l'app installée sur l'écran d'accueil et autorisée en mode Concentration, comme Telegram avant elle. La Mise en route vérifie qu'un propriétaire a un appareil.
- Sur une urgence, l'IA s'arrête déjà seule : une alerte manquée retarde un humain, elle ne laisse pas l'IA continuer.
- Un propriétaire qui a oublié son mot de passe passe par le serveur jusqu'à l'e-mail.
- Les récaps du matin et du soir manquent jusqu'au branchement de son agent IA.
