# 2026-10-29 — Archivage d'une alerte sous le verrou des noms (Bilan) — done
Fait : `archive` (`DELETE /v1/alerts/:groupId`) prend `lockNames`, comme `create` et `replace`. Sans le verrou, un `PUT` qui avait lu le groupe avant un `DELETE` simultané écrivait après lui : son `update` (qui remet `archived_at` à null) ramenait les lignes archivées, ou bien les lignes qu'il ajoutait sur une nouvelle créatrice restaient actives, alors que l'audit disait « archivé ». Test d'intégration : huit tours d'un `PUT` (qui ajoute une créatrice) et d'un `DELETE` envoyés ensemble ; si les deux réussissent, toutes les lignes sont archivées, sinon le `PUT` répond 404. Le test échoue sans le correctif.
Pas fait : rien.
Décisions : le même verrou que les noms plutôt qu'un `for update` sur les lignes du groupe : `replace` insère des lignes qu'aucun verrou de ligne ne couvrait, et un seul écrivain d'alertes à la fois suffit à ce volume.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `custom-alerts.integration` 6/6, le test de course répété quatre fois.
