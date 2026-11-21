# 2026-11-21 — INS-02 lot e2b (relier un lien au service, tâche horaire) — in progress

Fait : route « relier ce lien » du propriétaire seul (la référence est relue auprès du service par l'adresse du lien, jamais reçue du navigateur), écrite par la politique `owner_attach` ; référence remise à nul quand l'adresse change ; `attached` dans la lecture de l'agence. Tâche `connector.read_link_hours` câblée (crontab, worker) : clé lue une fois, créatrices lues à leur tour, 90 appels au plus, arrêt quand le service refuse ou limite. Plafond `modules/connectors` 39 → 40. Tests : route (6), passage horaire (4), magasin.
Reste : lot e3 (bouton « Relier » et heures dans Trafic, captures validées par Charles).
Découvertes : le lecteur du service de redirection porte désormais aussi les heures ; les deux faux des tests d'intégration le suivent.
