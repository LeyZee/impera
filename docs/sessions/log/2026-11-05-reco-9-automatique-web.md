# 2026-11-05 — Reco 9 côté écran : Automatique redemande le mot de passe — done

Fait : sur le Dashboard, choisir Automatique alors que le mot de passe et le code n'ont pas été donnés depuis 10 minutes (403 `reauthentication_forbidden`, #557) ouvre « Passer en Automatique » : le même `PasswordPrompt` que les clés, avec le nom de la créatrice. Confirmé, le contrôle renvoie Automatique ; « Annuler », Échap ou un clic dehors laissent le mode comme il était, sans message d'erreur. Arrêt et Copilote ne passent jamais par là. `useAgentModeWriter` expose `asking`, `confirmed` et `cancelled` ; un autre choix fait pendant la demande (un Arrêt) l'emporte et ferme la fenêtre.
Pas fait : rien de ce périmètre. Le passage d'une seule conversation en Automatique n'a pas d'écran aujourd'hui.
Décisions : la demande est une question, pas une erreur : rien dans le coin du contrôle tant qu'elle est ouverte.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `DashboardPage.test.tsx` (2 nouveaux : confirmé puis renvoyé, annulé sans rien changer) ; captures Nuit et Jour, ordinateur et téléphone, hors dépôt (`recette/2026-11-05/corrections/extension/reco9-automatique/`).
