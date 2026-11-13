# 2026-11-13 · Recette du socle : plafond du jour et plafond de veille réglables

Fait : choix de Charles du 12/11 (« Oui, dans Réglages › Modèles IA »). Le plafond du jour (20 € par défaut) et le plafond de veille (1 €) se règlent dans une carte « Budget IA » sous les services, propriétaire seul. Table `ai_budget_settings` (migration 0183, une ligne pour l'agence, RLS forcée, politique agence), module `ai-budget`, routes `/v1/settings/ai-budget` (écriture sous connexion récente, auditée avant et après). La passerelle lit les plafonds dans un cache mémoire relu au plus toutes les 60 s ; la première lecture doit réussir pour démarrer, puis une lecture en échec garde la dernière valeur : jamais de plafond levé. Un plafond baissé sous la dépense du jour arrête l'agent tout de suite, et l'écran le dit avant l'enregistrement. Forme demandée par Bilan (relecteur).
Vérifié : tests unitaires (domaine, cache), intégration Postgres (rôles, bornes, plafond de veille au-dessus du plafond du jour, arrêt immédiat lu par Consommation IA, audit, retour aux défauts), tests de l'écran ; captures Nuit et Jour, PC et iPhone 13, dans le bac à sable.
Reste : rien.
Découvertes : aucune.
