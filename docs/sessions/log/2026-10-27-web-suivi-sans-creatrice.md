# 2026-10-27 — Suivi fermé à la créatrice (ADR 0023) — done
Fait : une créatrice connectée au CRM n'a plus Suivi dans son rail (`RailKind` `creator` : Dashboard, Entraîner, Créatrices, Réglages, jusqu'à sa PWA, EQ-09) ; une adresse de Suivi la renvoie sur le Dashboard. À fusionner avec la PR de Bilan qui ferme les routes des conversations côté serveur.
Pas fait : rien.
Décisions : `canDecide` reste dans Suivi : « Voir comme » (EQ-19) en aura besoin pour une vue en lecture seule.
Découvertes : le Dashboard d'une créatrice garde des liens vers Suivi (« Voir l'urgence », les fans) qui la renverront sur le Dashboard ; à trancher avec le fil Dashboard et Bilan (ce que le Dashboard montre à une créatrice).
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web : nav.test.ts, AppShell.test.tsx).
