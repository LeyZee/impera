# 2026-10-23 — Suivi : une note à l'agent en rendant la main — done
Fait : quand un humain a la main, le lecteur de Suivi propose un champ facultatif « À retenir sur ce fan », vide par défaut, 300 caractères au plus (`ReleaseBodySchema`, #138). « Rendre la main à l’agent » l'envoie dans `POST …/release { note }`, sans espaces autour ; vide, le corps reste `{}`. Le serveur la garde comme fait du fan (`operator_note`) que le moteur lit. Le champ disparaît pour une créatrice, qui lit sans décider.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web) ; `TrackingPage.test.tsx` (note envoyée sans espaces, corps vide sans note, limite à 300) ; rendu dans Chromium à 1440 et 400 px, sans défilement horizontal.
