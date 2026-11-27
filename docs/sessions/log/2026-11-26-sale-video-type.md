# 2026-11-26 — Coffre Impera : le type d'une vidéo à vendre, choisi au dépôt (ADR 0163 § 7) — done
Fait : colonne `content_drops.ready_video_id` (vide, ou une ligne `rv_` sur une vidéo à vendre seulement) ; dépôt refusé sans type ou d'un type retiré, type refusé sur une autre catégorie, correction de catégorie refusée pour une vidéo typée, rejeu comparé au type ; `GET /v1/creator-space/ready-videos` et `GET /v1/creators/:creatorId/ready-videos` (propriétaire, manager de la créatrice ; noms seulement) ; `pickSaleVideo` pour l'agent (type encore en vente, validée, jamais envoyée à ce fan, prix tiré dans la fourchette) ; choix du type en puces dans la fiche de dépôt de la créatrice, « Envoyer » gris tant qu'il manque.
Pas fait : figer le prix dans l'offre et noter la vente (fil Agent) ; le même choix côté agence si elle dépose un jour pour la créatrice.
Décisions : le type se choisit au dépôt, jamais après ; une vidéo typée garde sa catégorie, sans nouveau droit de mise à jour sur la base.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : intégration `content-stock` et `reserved-media` ; tests de la page Contenu ; `pnpm check`.
