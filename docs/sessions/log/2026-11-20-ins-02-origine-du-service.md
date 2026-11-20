# 2026-11-20 — INS-02 lot c1 (origine du service de redirection, lue dans le déploiement) — in progress

Fait : `LINK_SERVICE_ORIGIN` dans la configuration de l'API, validée au démarrage par `linkServiceOriginOf` (avenant du 20/11 à l'ADR 0120 § 3) ; `.env.example`, `docker-compose.prod.yml` et le runbook de déploiement la décrivent sans nommer le service. Tests dans `server.test.ts`.
Reste : clé scellée dans Réglages, adaptateur officiel, route « Détecter ses liens » (lot c2), bloqués tant que la description de l'API du service n'est pas connue.
Découvertes : aucune documentation publique de l'API du service de redirection n'a été trouvée ; sans elle l'adaptateur ne peut pas être écrit contre autre chose que le faux.
