# 2026-11-20 — Objectifs mensuels par créatrice — in-progress
Fait : ADR 0092 § 6. Table des objectifs (RLS forcée, propriétaire seul en écriture, fermée à la créatrice et au rôle de service), routes d'écriture journalisées, lecture dans la réponse du Dashboard de l'agence sur un mois civil avec la projection linéaire, carte « Objectifs du mois » avec saisie en euros pour le propriétaire.
Pas fait : captures, renumérotation de la migration à son tour, relectures sur le dernier commit.
Décisions : aucune ADR touchée. Schéma validé par Bilan avec quatre retouches (journal, rôle de service fermé, borne haute du montant, auteur = dernier à écrire).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires (domaine, écran, MCP) et pnpm check ; intégration écrite, jouée par la CI (Docker absent ici).
