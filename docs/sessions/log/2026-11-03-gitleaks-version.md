# 2026-11-03 — gitleaks : version minimale et aide du push — done
Fait :
- `scripts/gitleaks-hook.mjs` lit `gitleaks version` avant de scanner. Sous 8.19 (la première version qui a `gitleaks git`), ou si la version est illisible, le hook s'arrête et dit comment mettre à jour. Avant, un vieux binaire répondait par son aide.
- Quand le scan d'un push trouve un secret, le hook explique qu'il relit toutes les branches locales absentes d'`origin`, donne la commande qui les liste, et dit comment archiver une vieille branche plutôt que de contourner le hook.
- Le commentaire de la CI ne prétend plus que les hooks utilisent la même version.
- `security.md` est à jour.
Pas fait : rien.
Décisions : le hook vérifie un minimum, il n'impose pas la version de la CI, pour que chaque fil garde son binaire tant qu'il suffit.
Découvertes : le gitleaks de `/usr/bin` des conteneurs est antérieur à 8.19 (signalé par Chantier 7). Un commit WIP local d'Équipe bloquait ses push (signalé par le coordinateur).
Candidats à suppression : aucun.
Vérifié : `pnpm test:scripts` (25 tests, dont 3 nouveaux : lecture de la version, minimum, faux binaire 8.18.4 refusé ; le test du secret inventé vérifie l'aide du push).
