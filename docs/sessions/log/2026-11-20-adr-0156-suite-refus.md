# 2026-11-20 — ADR 0156, lot 4 : après un refus, demander pourquoi, insister, bouder, lâcher — in progress
Fait : `agent/domain/refusal.ts` décide, réponse après réponse, la suite d'un refus d'étape payante (demander ce qui ne lui a pas plu, insister un peu une fois, bouder une fois, puis lâcher), dans la session du refus seulement ; `maySulk` a enfin un appelant : avec un fan gelé, fragile, « ne plus lui écrire » ou en soin, seule la question reste. La voix reçoit une consigne écrite par le code, jamais un prix ni une nouvelle offre. Terme « Suite d'un refus » au glossaire, scénario d'éval `script-refused-asks-why` (non lancé).
Pas fait : garder la raison qu'il donne, datée, dans sa fiche (avec la mémoire datée) ; les lots 5 et 6.
Découvertes : aucune.
Ajout (Charles, 20/11) : s'il a déjà payé une étape du script, elle demande seulement ce qui n'a pas plu ; ni insistance ni bouderie, c'est l'aftercare.
