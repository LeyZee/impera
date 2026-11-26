# 2026-11-26 — EVAL-01 Fans simulés — in_progress
Fait : passerelle du fan simulé et du juge de relation (`@impera/llm`), commande `pnpm fan-sim` sur la session du Playground, catalogue inventé à thèmes, fiche de Julien, tests (unitaires et une semaine sur la vraie session avec une voix factice).
Pas fait : les 7 autres fans, aucun lancement payant (attend le mot de Charles dans le fil Bilan).
Décisions : brouillon d'ADR « fan simulé » remis au fil Bilan pour numérotation ; le fan joue sur le rôle `judge` d'une configuration propre (Gemini, sinon Mistral), jamais le modèle de la voix.
Découvertes : les deux scripts d'essai du Playground sont trop sages pour tester le choix du script selon le fantasme.
Candidats à suppression : aucun.
Vérifié : typecheck ✓, lint ✓, knip ✓, prettier ✓, tests de fan-sim et de @impera/llm ✓.
