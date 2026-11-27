# Règles en vigueur, par sujet

Porte d’entrée pour retrouver vite la règle qui s’applique aujourd’hui, sans lire les 150 décisions ni le journal. Rangé le 27/11/2026 à la demande de Charles : rien n’a été effacé ni reformulé, ces pages ne font que relier.

## Comment lire

- Chaque page de sujet liste ses décisions (`docs/adr/`) dans l’ordre. Le titre d’une décision est sa règle en une phrase ; le détail est dans le fichier.
- « En partie changée par » : une décision plus récente remplace un passage précis. Le texte d’origine reste intact ; le bandeau en tête de l’ancienne dit quel passage, avec les mots de la nouvelle.
- « Précisée ou complétée par » : une décision plus récente ajoute sans rien retirer.
- Le métier du chatting (comment elle parle et vend) est dans la méthode de l’agence, hors de ce dépôt public. En cas de désaccord entre une décision d’ici et la méthode, on le signale à Charles.
- L’état réel de chaque fiche de tâche : [`docs/sessions/etat-des-fiches.md`](../sessions/etat-des-fiches.md).
- Toutes les décisions et leurs liens : [carte des décisions](carte-des-decisions.md).

## Sujets

- [Fondations techniques](fondations.md) — Langage, découpage en modules, base de données, file de jobs, IA derrière une passerelle, argent et identifiants. (15 décisions)
- [Reveal et l’extension](reveal.md) — Comment Impera lit et écrit chez Reveal, et ce que fait l’extension Chrome. (12 décisions)
- [L’agent IA : persona, voix, sécurité de la conversation](agent.md) — Qui parle, avec quelle persona, dans quelle langue, et ce que le code interdit quoi qu’il arrive. (14 décisions)
- [Vente et scripts](vente-et-scripts.md) — Les scripts de vente, leur déroulé fan par fan, le prix, les pauses, le sur-mesure, les fans qui n’achètent pas. (18 décisions)
- [Le fan : fiche, mémoire, ce que la créatrice en voit](fans.md) — Ce qu’on retient d’un fan, qui l’écrit, et ce qui en est montré à la créatrice. (7 décisions)
- [Le chatteur : shift, copilote, rapports, relecture](chatteurs.md) — Ce que le chatteur fait pendant son shift, ce que le copilote lui montre, comment son travail est relu et compté. (13 décisions)
- [Équipe, rôles, planning, navigation](equipe.md) — Qui voit quoi, le calendrier des shifts, les congés, la navigation du CRM. (9 décisions)
- [Paie et factures](paie-et-factures.md) — La quinzaine, les taux, les reports, les avoirs, les factures et le versement. (11 décisions)
- [Espace de la créatrice, contenu et coffre](creatrice-et-contenu.md) — Ce que la créatrice voit et fait dans Impera, ses dépôts, le coffre, ses gains. (13 décisions)
- [Publication : feed, Mass DM, Instagram, canal Telegram, idées](publication.md) — Ce qui part en public et en masse, qui le prépare, qui le valide. (11 décisions)
- [Pilotage de l’agence : chiffres et alertes](pilotage.md) — Le Dashboard, la valeur des chatteurs, la consommation IA, les alertes par créatrice. (6 décisions)
- [Mode Automatique et mesure de l’IA](mode-automatique.md) — Quand l’IA a le droit d’envoyer seule, et comment on le mesure. (4 décisions)
- [Accès, sécurité des comptes, agents connectés](acces-et-agents.md) — Connexion, deuxième facteur, durée des sessions, clés IA, comptes de secours, serveur MCP. (9 décisions)
- [Notifications et Telegram](notifications.md) — Qui est prévenu de quoi, et par où. (2 décisions)
- [Hébergement, déploiement, sauvegardes, nom et design](exploitation.md) — Où tourne Impera, comment on déploie et on restaure, le nom du projet, le design system. (6 décisions)

## Ce qui n’est pas une règle

- `docs/sessions/log/` : le journal des sessions, figé. Utile pour savoir pourquoi, jamais pour savoir quoi.
- `brainstorm/` et le cahier des charges à la racine : l’historique du raisonnement d’origine.
- `docs/recette/`, `docs/bilans/` : des comptes rendus datés.
