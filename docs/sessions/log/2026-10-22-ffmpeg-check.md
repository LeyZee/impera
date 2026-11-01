# 2026-10-22 — ffmpeg vérifié au démarrage, messages clairs dans les tests — done

Fait : `missingMediaBinaries()` (exporté par `media/index.ts`) lance `ffmpeg -version` et `ffprobe -version` et rend ceux qui ne répondent pas. La racine de composition l'appelle une fois au démarrage : une ligne `warn` « ffmpeg missing » avec la liste, sans empêcher l'API de démarrer. Les outils média disent « ffmpeg absent : introuvable sur le PATH. Installe ffmpeg… » au lieu de `spawn ENOENT`, et les tests qui lancent le vrai ffmpeg s'arrêtent sur « ffmpeg et ffprobe absents du PATH : installe ffmpeg… ».

Pas fait : l'affichage dans le CRM (fil Dashboard, ambre) ; la vérification sous Windows (session Remote Control, après la fusion).

Décisions : un avertissement, pas un arrêt : sans ffmpeg, seul ce qui touche aux vidéos et aux notes vocales manque.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test` ; simulation sans ffmpeg (`PATH` vide) : message clair, test des binaires absents.
