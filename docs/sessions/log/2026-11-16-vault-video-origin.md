# 2026-11-16 — vault-video-origin (vidéos du coffre lisibles) — done
Fait : le téléchargement d'un fichier du coffre envoie `Referer` (valeur fixe, l'adresse publique du tableau de bord) à l'hôte des vidéos seul, en HTTPS (`DownloadBounds.referer`, `REVEAL_VIDEO_REFERER`) ; aucun autre en-tête, aucun autre hôte, aucune redirection suivie. Avenant à l'ADR 0113 § 2.
Pas fait : passer les vidéos en échec derrière les photos dans la description du coffre (PR à part).
Décisions : « Oui » de Charles à 23 h 41 UTC le 16/11 (fil Bilan) ; bornes fixées par Sécurité.
Découvertes : sans cet en-tête, l'hôte des vidéos répond 403, lu comme un lien expiré : toutes les vidéos du coffre restaient « plus tard ».
Candidats à suppression : aucun.
Vérifié : pnpm check, tests unitaires du module connectors.
