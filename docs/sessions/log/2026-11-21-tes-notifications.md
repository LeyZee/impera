# 2026-11-21 — « Tes notifications » (trou 9 de l'audit des trous béants) — done
Fait : `GET /v1/notifications/inbox` (tous les rôles, chacun les siennes, RLS `own_rows`, 7 jours, 60 lignes au plus) lit `notification_deliveries` déjà écrite ; `quiet` vrai pour celles qui n'ont pas sonné seules (heures calmes puis récapitulatif, ou plafond du jour). Le récapitulatif du matin ouvre `/notifications` au lieu de `/`. En tête de /notifications : la réponse (« 2 arrivées sans sonner »), une barre des cinq familles en couleur (argent, ta journée, équipe, alertes, sécurité), puis chaque ligne par jour, d'un toucher vers sa page.
Pas fait : faire sonner chez la modèle une demande de contenu, une proposition, une semaine prête et un script demandé (motifs absents de la contrainte de `notification_deliveries`) : à faire sur les sortes de la PR #881, fil Alertes. Pas de compteur « non lues » (il faudrait une colonne : migration).
Décisions : aucune ADR ; lecture seule d'une table existante, aucune migration.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests web de src/pwa ✓ (75), tests api du module ✓ ; test d'intégration écrit (Docker absent ici, la CI le joue).
