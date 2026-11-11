# 2026-11-11 · P2-01 capture de la session Reveal (Bilan)

Fait : serveur (schéma de session Reveal, routes Sync par la liaison du propriétaire, refus 401/403/409/422, jeton d'appareil retiré) ; extension (lecture du Bearer, du modèle et du membre dans les requêtes de l'onglet Reveal via `webRequest`, envoi puis oubli, bouton « Synchroniser » du popup pour le propriétaire seul) ; aide `/aide/reveal` ; spécification § 2, runbook `session-expired.md`, fiche.
Vérifié : tests unitaires extension (capture, API, orchestration, popup, manifeste), tests d'intégration connecteurs (10), tests web (route réservée au propriétaire) ; captures Nuit/Jour du popup (4 états) et de l'aide (PC, téléphone).
Reste : V1 et V2 sur le PC de Charles, à sa demande écrite.
Découvertes : le lead « Reveal est déconnecté » du Dashboard (DASH-18) peut maintenant mener à `/aide/reveal`.
