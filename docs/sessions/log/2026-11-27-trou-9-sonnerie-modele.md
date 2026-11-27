# 27/11/2026 — Trou 9 : ce que l'agence demande sonne chez la modèle

- **Fiche** : trou 9 du rapport « trous béants » du 21/11 (validé par Charles), suite de #881 (sortes de notification).
- **Fait** : job `notifications.creator_notices` toutes les cinq minutes (demi-heure relue) : demande de contenu ouverte (agence, stock, idée, script de la cadence) et proposition de l'agence pour son agenda → sorte `agency_request` ; semaine validée par le propriétaire → `week_to_validate`. Une notification par compte et par chose demandée (clé `content_request:<id>`, `proposition:<id>`, `week:<lundi>`), raison `decision` (gardée la nuit, dans le plafond). L'écran verrouillé ne dit jamais le texte de la demande. Tests : domaine (textes, sortes, clés) et intégration (fenêtre, filtres, comptes).
- **Rôle de service** : +1 accès dans `notifications` (3 → 4) : le job lit, pour toutes les créatrices, les demandes, propositions et semaines d'une demi-heure, et ses comptes ; lecture seule. Relecture Sécurité demandée.
- **Reste** : rien sur ce trou. La question « À décider » (ADR 0164) sonne déjà, hors sortes.
- **Découvertes** : aucune.
