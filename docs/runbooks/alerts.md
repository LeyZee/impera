# Alertes de l'agence

Depuis le 27/11/2026, tout ce qui demande un humain sonne en notification Impera, sur les appareils où chaque compte a activé ses notifications (ADR 0176). Une notification ne contient jamais le texte d'un fan : elle dit quoi, pour quelle créatrice, et ouvre l'écran où agir.

## À la réception

| Notification | Que faire |
|---|---|
| **Relais de sécurité** (mineur possible, non-consentement, détresse, rencontre, manipulation) | Ouvrir tout de suite. L'agent n'écrit plus à ce fan. Prendre la conversation (« Reprendre la main ») : la relance s'arrête. Sans prise en main, elle sonne de nouveau toutes les 5 minutes pendant une heure. Mineur ou non-consentement : ne rien envoyer, prévenir Charles. |
| **URGENT**, alerte de sécurité | Un acte sur un compte (nouvel appareil, refus répétés, deuxième facteur remis à zéro, persona activée, Automatique allumé, session Reveal remplacée). Si ce n'est pas toi ou quelqu'un de l'équipe : Réglages › Sécurité, fermer les sessions, puis `rotate-secrets.md`. |
| **URGENT**, quota IA épuisé | L'agent répond avec son modèle de secours. Recharger ou attendre la remise à zéro du quota. |
| **Urgent · Lecture Reveal coupée** (même la nuit, une fois par panne) | L'IA ne lit plus les fans et ne leur répond plus. Session expirée : reconnecter le « bot » puis « Synchroniser » (`session-expired.md`). Reveal ne répond plus : attendre quelques minutes, la lecture reprend seule ; sinon prévenir l'équipe technique. Reveal a changé sa façon de répondre : la lecture doit être adaptée dans le code ; passer les créatrices en copilote en attendant. **Lecture Reveal rétablie** arrive ensuite sans son. |
| **Reconnexion Reveal** (chaque jour à l'heure réglée, encore une heure après, 2 h avant la fin d'un jeton) | Dans le profil Chrome de l'IA, reconnecter le « bot » sur Reveal puis « Synchroniser » dans l'extension (`session-expired.md`, étapes 1 et 2). L'heure se règle dans Réglages › Alertes › Pilotage. |
| **Important** (passage à l'humain, plafond IA, session Reveal, panne, factures, sauvegarde, ventes) | Ouvrir quand possible. Session Reveal : suivre `session-expired.md`. |

## Quand rien ne sonne la nuit

1. Mise en route du Dashboard : l'étape « Alertes de nuit » est faite quand un propriétaire a au moins un appareil qui reçoit les notifications.
2. Moi › Notifications sur le téléphone : l'appareil doit y être activé.
3. iPhone : l'app doit être installée sur l'écran d'accueil et autorisée dans le mode Concentration.
4. Les heures calmes retiennent tout sauf les relais de sécurité, les alertes urgentes de l'agence (dont la lecture Reveal coupée) et son propre shift.

## Mot de passe oublié

La page de connexion n'envoie plus de lien (ADR 0176 § 8).

- Un membre de l'équipe ou une créatrice : un propriétaire lui fait un lien depuis Équipe (« Nouveau mot de passe »).
- Un propriétaire : sur le serveur, `pnpm ops:password-reset-link --email <son e-mail>`. Le lien s'affiche là, vaut 15 minutes, sert une fois ; on le lui donne de vive voix ou en main propre, jamais dans un chat. La commande se lance dans un terminal interactif sur le serveur, jamais dans une tâche planifiée ou un déploiement dont l'hébergeur garde le journal : le lien y resterait écrit. Le deuxième facteur reste demandé à la connexion suivante.
