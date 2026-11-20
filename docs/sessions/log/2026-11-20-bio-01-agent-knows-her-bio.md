# 2026-11-20 — BIO-01 L'IA connaît la bio de la créatrice — done
Fait : ADR 0154 (acceptée par Charles, la bio prime sur la fiche) ; lecture seule de la bio au poll, gardée sur le compte de plateforme (migration 0237) ; bloc `<profile_bio>` pour cerveau, voix et juge, filtré contre l'injection ; Playground et évaluations (scénario fictif `bio-allusion`).
Pas fait : scénario `bio-allusion` non lancé (payant) ; vérification sur le PC que `description` porte la bio affichée.
Décisions : ADR 0154. Les accroches cliquables restaient couvertes par l'ADR 0110 § 1 : rien changé.
Découvertes : la voix des commentaires Instagram et du canal Telegram ne reçoit pas la bio (hors périmètre, à décider) ; `getCreatorNotes` (note du modèle) n'a toujours aucun appelant.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests ciblés connectors/agent/playground/evals/llm ✓, intégration reveal-connector ✓.
