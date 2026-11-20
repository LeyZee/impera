# 2026-11-19 — SCB-04 Éditeur des scripts, lot 1 serveur — in_progress
Fait : scripts en préparation (`prepared_scripts`, migration 0229, RLS forcée, fermée au compte de la créatrice) ; manques et refus de l'ADR 0112 § 14 comptés à chaque lecture (`preparedScriptGaps`, reprend `branchGaps`), avertissements de prix chemin par chemin ; états `editing`, `ready_to_copy`, `matched` ; routes `GET/POST/PUT …/prepared-scripts`, `…/ready`, `…/editing`, journalisées.
Pas fait : reconnaissance à l'import (lot 2), écran (lot 3, attend l'ADR 0149 sur `main`), Performances (lot 4).
Décisions : « script en préparation » plutôt que « brouillon » (réservé aux réponses de l'agent), au glossaire ; contenu en JSON validé par le contrat, révision entière pour les enregistrements concurrents ; création sous l'identifiant du client pour le rejeu.
Découvertes : l'import au choix du coffre (ADR 0145 § 5) n'est pas sur `main` : un média absent = non listé par son coffre.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; intégration locale (Docker) des scripts en préparation et des balayages.
