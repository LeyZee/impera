# 2026-11-27 — Time waster « vraiment pénible » : les sept signes (ADR 0135, précisions du 27/11) — in progress
Fait : codes `FanSign` (contrat) et événement `fan_signs_seen` (codes seulement) ; `fanSignsOf` (agent/domain/signs) lit, pour un time waster seulement, la preuve redemandée, le marchandage, le gratuit réclamé, l'insulte ou la pression, le contact ou la rencontre réclamés, la promesse d'achat (code, quatre langues) et les excuses ; le job de réponse les journalise ; `timeWasterWait` compte les signes différents depuis 14 jours et depuis ses dernières excuses (contact et promesse non tenue à partir de deux, la promesse rompue après 48 h, le script laissé en plan lu dans les déroulés) ; « veille » à trois fois les scripts sans achat et deux signes.
Pas fait : migration 0277 (type `fan_signs_seen` dans les deux contrôles), à chaîner sur 0276 après la fusion de #1040 (Bilan).
Décisions : les sept signes et les excuses (Charles, 27/11 0 h 32 à 0 h 34).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires (signes, comptage, niveau, journal côté composeur).
