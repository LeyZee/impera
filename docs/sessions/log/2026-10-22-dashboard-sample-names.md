# 2026-10-22 — Dashboard : un prénom inventé pour un fan de l'exemple — done

Fait : le fan d'exemple « Lucas » de `screens/dashboard/sample.ts` devient « Basile ». Le dépôt est public, et « Lucas » est le prénom d'une personne réelle de l'agence (ADR 0010 : aucune donnée réelle).
Pas fait : rien dans ce fil.
Décisions : aucune.
Découvertes : « Lucas » apparaît encore comme chatteur dans le module Telegram (`render.ts`, ses tests, `contracts/telegram.ts`, l'aperçu de `TelegramSection.tsx`, `model.test.ts`) et dans `brainstorm/05-revue-independante.md`, avec deux autres prénoms réels. C'est au fil Telegram de s'en occuper, et à Charles pour le brainstorm.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓.
