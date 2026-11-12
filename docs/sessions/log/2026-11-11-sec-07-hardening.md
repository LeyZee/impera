# 2026-11-11 — SEC-07 Durcissement : liens d'extension, limites par adresse, appels sortants — done
Fait : `limitKeyOf` (IPv6 compté par `/64`) pour le limiteur global et les limites de connexion, de sécurité et du flux des ventes ; `revokeExtensionLinks` appelé à la fermeture des sessions, au nouveau mot de passe et à la remise à zéro du code ; lien d'extension périmé après 30 jours sans usage ; photo de créatrice récupérée à l'adresse vérifiée (`pinnedGet`) ; refus du flux des ventes écrit une fois par minute au plus ; scénario `evals/adversarial/off-topic-recipe.yaml`.
Pas fait : reconfirmation à la création d'un lien par le propriétaire (écran, lot suivant) ; bornes du message entrant et plafond par conversation (choix de Charles attendu).
Décisions : aucune ADR.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, tests d'intégration touchés ✓ sur un Postgres local (trends, security-settings, copilot, connectors, auth-limits, sales-feed) ; `pnpm evals` non joué (pas de clé).
