# 2026-11-05 — CRM-07 lot a2a : veiller sur la liste des modèles de Reveal

Fait :
- la lecture des ventes relit `/v1/models` un quart d'heure au plus souvent, avant les ventes ; une liste illisible n'empêche pas de lire les ventes ;
- `sightingChanges` (`connectors/domain/model-sightings.ts`) : une modèle reliée absente de la liste ou passée `banned` lève une fois `model_gone` ou `model_banned`, à nouveau seulement après son retour ; une liste vide ne compte personne comme partie ;
- un statut inconnu lève `unknown_value` (champ `status`) une fois ;
- migration 0116 : `sales_feed_model_sightings` (RLS forcée, SELECT, INSERT et UPDATE pour le rôle applicatif), déclencheur du scan Telegram recréé avec `sales_feed_signal` ;
- Telegram : `model_gone` et `model_banned` en Important, sans nom ni identifiant ;
- `GET /v1/settings/sales-feeds/new-models` (propriétaire) : le compteur du badge du lot b2.

Pas fait (a2b) : la photo copiée dans notre stockage.

Décisions :
- le signal part avant la marque : un échec entre les deux le répète au lieu de le perdre ;
- une modèle reliée jamais vue avant sa disparition reçoit sa ligne (`other`, inactive) pour n'être signalée qu'une fois ;
- le compteur du badge ne lit que la dernière liste vue de chaque plateforme, sans appel à la plateforme ;
- numéros : cette migration prend 0116, la première à arriver sur `main` ; celle de l'ADR 0068 (liaison Telegram), pas encore écrite, prendra 0117 (`check-drift` exige un numéro plus grand que le dernier snapshot) ;
- l'ADR 0020 gagne la ligne de `sales_feed_signal` dans son tableau des événements, comme pour les autres producteurs.

Découvertes :
- aucune.

Vérifié :
- `pnpm check` ;
- unitaire `model-sightings`, domaine et infra de `telegram` ;
- intégration `sales-feed-models` (badge, écartée, départ, liste vide, retour, bannie, statut inconnu, droits), `sales-feed`, `sales-feed-import`, `sales-feed-check`, `sales-feed-auto-check`, `sales-totals`, `connection-state`, `dashboard-reveal-sales`, `payroll-sales`, `telegram`.
