# 2026-10-27 — Libellés des gardes dans le Suivi (P3-13, web) — done
Fait : un brouillon refusé par une garde dit, en groupes nominaux, les quatre nouvelles gardes bloquantes (didascalie, média annoncé non joint, mot de rencontre que Reveal repère, maladie, dette ou urgence pour vendre). Les libellés sont dans `apps/web/src/agent/guards.ts`, en `Record<GuardCode, string>` sur `GUARD_CODES`.
Pas fait : rien.
Décisions : les libellés couvrent toute la liste, souples compris (la fiche disait « pas de libellé pour les deux souples ») : le contrat de #228 veut un libellé pour chaque code qu'un écran peut montrer, et un test d'exhaustivité attrape le prochain code ajouté. Un code inconnu de l'écran est tu.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web : guards.test.ts, reader-model.test.ts).
