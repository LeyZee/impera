# 2026-11-05 — Recette de tous les workflows, corrections — done
Fait : recette par six testeurs automatisés (accès et sécurité, propriétaire, équipe et paie, chatteur, créatrice, moteur et extension), 135 constats dont 2 bloquants et 21 majeurs ; corrections de la part de ce fil : robustesse de l'API (caractère NUL, 503, 404, erreurs du routeur, journaux sans paramètres SQL), accès web (retour à la connexion, `GET /v1/session`, messages de validation, codes de secours), Suivi du chatteur (créatrices routées, limites du fan lisibles, groupement « À toi », confirmation d'un passage grave), autres écrans chatteur, 26 constats propriétaire, plus aucune barre colorée sur le côté des cartes.
Pas fait : les constats des autres fils (Agent, Bilan, Équipe, Chantier 7, Popup) ; CHAT-19 et la bulle CHAT-26, couverts autrement par D-03 (#521) ; questions de paie 11 à 17 et 21 laissées à Charles.
Décisions : « go recos » de Charles (05/11 18h38) appliqué ; sur un doublon avec #521, main gagne.
Découvertes : PRO-11 reste ouvert pour 16 champs `type="date"` hors Créatrices ; « Ouvrir Reveal » n'a pas d'adresse de discussion connue.
Candidats à suppression : aucun.
Vérifié : typecheck, lint, prettier, pnpm test ✓ ; intégration sur Postgres local pour les routes touchées.
