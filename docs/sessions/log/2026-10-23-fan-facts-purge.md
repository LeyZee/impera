# 2026-10-23 — Mémoire du fan : purge des faits un an après le dernier contact (P3-02, PR 4b) — done

Fait : job `fans.purge_facts` (contracts, une tentative), lancé chaque nuit à 3 h 45 (`crontab.ts`) : il supprime tous les faits d'un fan dont `fans.last_seen_at` date de plus de 365 jours, historique compris (`superseded_by` ne pointe que dans un même fan). Rôle propriétaire (`FansDeps.adminDb`), pour toutes les créatrices à la fois. La racine de composition passe `adminDb` au module et déclare la tâche, qui logue le nombre de faits supprimés. Test d'intégration : le fan vu il y a 400 jours perd ses deux faits, l'autre garde le sien, un second passage ne supprime rien.

Pas fait : les drapeaux du fan (lire, poser, lever avec leur auteur) : un type d'événement nouveau change le check de `domain_events.type`, donc la migration 0015 de Bilan. Purge des résumés : rien ne les écrit encore.

Décisions : la date du dernier contact est `fans.last_seen_at` ; `expires_at` reste filtré à la lecture, sans suppression (un fait remplacé peut pointer vers lui).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `apps/api` complète contre Postgres 16 (125 tests).
