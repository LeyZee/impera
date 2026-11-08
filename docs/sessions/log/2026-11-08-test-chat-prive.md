# 2026-11-08 — Un test du chat privé Telegram attendait le mauvais signal — fait

**Session** : Équipe · **Branche** : `claude/project-thread-cohhca`

Fait : dans `PrivateChat.test.tsx`, le test « gives a code… » attendait « @demo_bot » pour juger le chat relié. Or ce nom est déjà sur la ligne du code (« Ouvre la conversation avec @demo_bot »), avant que le bot relie le chat. Le test reprenait donc la main avant la relecture, et sous charge « 06/11/2026 » n'était pas encore là. Il attend maintenant la date, qui n'existe qu'une fois le chat relié. Reproduit à coup sûr en retardant de 60 ms la réponse « relié » : l'ancien test échoue, le nouveau passe.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : le test seul (avec et sans retard), pnpm check, pnpm test (pre-push).
