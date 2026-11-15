# 2026-11-11 — Copilote : le panneau reconnaît l'adresse d'une conversation Reveal — done
Fait : premier essai du panneau copilote face au vrai Reveal sur le PC, le panneau restait sur « Ouvre une conversation dans Reveal ». Cause : `openConversationOf` devinait l'adresse avant la capture (`/messages/…`, `/chat/…`, paramètres `conversation`, `chat`) ; le tableau de bord de Reveal écrit `/models/<modèle>/conversations/<conversation>`. La règle lit désormais l'identifiant qui suit le dernier `conversations` et finit l'adresse, et rien d'autre ; tests avec des UUID inventés.
Pas fait : vérification sur le PC après installation de la nouvelle extension (Charles).
Décisions : aucune ADR (ADR 0086 § 2 prévoyait de lire l'adresse).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests de `apps/extension/src/lib/copilot` ✓, typecheck de l'extension ✓, pnpm check ✓.
