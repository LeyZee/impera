# 2026-11-17 — check-repo-conflict-markers (marqueurs de conflit refusés) — done
Fait : `scripts/check-repo.mjs` (règle 10) refuse toute ligne de fichier texte qui commence par sept `<` ou sept `>` suivis d'une espace ou de la fin de ligne ; les snapshots de Drizzle sont exclus (texte généré). La ligne de sept `=` n'est pas visée : en Markdown, elle souligne un titre.
Pas fait : rien.
Décisions : signalé par le fil Agent ; la PR passe après #819, qui retire les marqueurs restés sur main.
Découvertes : #775 a fait entrer des marqueurs dans docs/adr/README.md et docs/glossary.md sans qu'aucun contrôle ne les voie.
Candidats à suppression : aucun.
Vérifié : `node scripts/check-repo.mjs` trouve les quatre marqueurs de main et rien d'autre ; prettier.
