# 2026-11-02 — Nirvana s'installe sur l'écran d'accueil (CR-01 lot a, fil espaces)
Fait : manifeste, icônes de la flamme (dont maskable et Apple), couleur de barre qui suit Nuit et Jour, service worker écrit à la main (page hors ligne, fichiers hachés, jamais `/v1/`), mise à jour proposée et jamais imposée, oubli de l'appareil à chaque déconnexion ou 401, carte « Nirvana sur ton écran d'accueil » sur téléphone, guide `/aide/installer`. Tests unitaires (logique d'installation, service worker dans un faux contexte, oubli de l'appareil, titre du guide, couleurs), contrôles d'en-têtes dans l'image Docker, parcours vérifié dans Chromium (mise à jour v1 → v2, hors ligne).
Pas fait : Web Push, heures calmes et `notification_deliveries` (lot b, migration 0064 à voir avec Bilan) ; clés d'accès (lot c) ; passe téléphone des écrans du chatteur (il faut une pile avec des données) ; vérification sur un vrai iPhone et un vrai Android.
Décisions : aucune dépendance (pas de vite-plugin-pwa, donc pas de quarantaine) ; « Mettre à jour » dit que la page se recharge, car un formulaire en cours serait perdu.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, `pnpm --filter @nirvana/web test` (1 100 tests).
