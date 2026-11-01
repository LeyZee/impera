# 2026-10-28 — P4-01 Réglages › Alertes (PR C1) — in_progress
Fait :
- `apps/web/src/settings/alerts/` : `model.ts` (brouillon, erreurs par champ aux limites du contrat, corps envoyé avec la phrase vide à `null`, interrupteur de chaque créatrice gardé, lignes « ce qu'elle surveille », « sur qui », « ce qu'elle fait », diffusion Telegram lue dans le routage), `api.ts` (`/v1/alerts` lu par le contrat, refus rangés par `ALERT_ERROR_CODES`), `AlertsSection.tsx` et `alerts.css`.
- Réglages : onglet « Alertes » réservé au propriétaire, avant Telegram ; adresse `/reglages/alertes`, tout autre rôle renvoyé sur Réglages.
- Réglages › Telegram : l'onglet dans l'adresse (`?onglet=ventes|mots-cles|validations|bots`, `settings/telegram/search.ts`), pour que « Choisir le groupe » et « Brancher un groupe » y mènent.
- `Entries` (persona) prend une clé de doublon (`keyOf`) ; la persona garde la casse seule.
- Tests : `model.test.ts`, `AlertsSection.test.tsx`, `search.test.ts`, deux cas de plus dans `AppShell.test.tsx`. Captures 1 440 et 400 px, Nuit et Jour, serveur coupé.
Pas fait : « Tester » (route de la PR B, Agent) et l'Historique du Suivi (PR A2, Bilan).
Décisions : aucune.
Découvertes : le serveur de développement de l'extension (WXT) prend le port 3000 de l'API quand on lance `pnpm dev` : l'API ne démarre pas et l'application affiche « Le serveur ne répond pas ».
