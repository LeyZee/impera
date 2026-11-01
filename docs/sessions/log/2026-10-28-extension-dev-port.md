# 2026-10-28 — Extension, port du serveur de dev (Extension) — done
Fait :
- Le serveur de dev WXT écoute sur le port 3100 (`apps/extension/wxt.config.ts`). Par défaut, WXT prend le premier port libre à partir de 3000 : sous `pnpm dev`, il démarrait avant l'API, lui prenait le 3000 et l'API ne démarrait plus (découverte du journal `2026-10-28-p4-01-alerts-screen.md`).
- README de l'extension : le port, et le bon dossier à charger en dev (`.output/chrome-mv3-dev`, pas `.output/chrome-mv3`).
Pas fait : rien.
Décisions : port fixe hors de la plage par défaut de WXT (3000–3010) ; `strictPort` laissé à faux, pour que WXT passe au port libre suivant plutôt que d'échouer si le 3100 est pris.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm dev` démarre WXT sur http://localhost:3100 et laisse le 3000 libre (l'API, sans Postgres dans le conteneur, s'arrête plus loin sur la connexion à la base, sans EADDRINUSE) ; pnpm check.
