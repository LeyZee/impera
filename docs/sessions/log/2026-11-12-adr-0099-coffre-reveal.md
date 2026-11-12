# 2026-11-12 — ADR 0099 Synchroniser le coffre Reveal et bâtir des scripts — done
Fait : ADR 0099 rédigée et acceptée par Charles (« ok 0099 », 23 h 27) : synchro du coffre, import des scripts existants, scripts composés dans le CRM puis créés dans Reveal sans téléversement, ordre d'upload de Reveal gardé.
Pas fait : le code (fiches à écrire : job de synchronisation et tables, téléchargement `fetchMedia`, écran, écritures de scripts dans P2-03).
Décisions : ADR 0099 acceptée.
Découvertes : `FakeReveal` trie le coffre du plus récent au plus ancien ; l'ordre réel de Reveal est à vérifier à la première lecture sur le PC.
Candidats à suppression : aucun.
Vérifié : docs seulement, CI de la PR.
