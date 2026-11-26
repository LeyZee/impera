# 2026-11-21 — Garde des lieux : un texte public ne nomme jamais où elle vit — done
Fait : `placeNames` lit sa ville et son « lieu de vie » dans sa persona active (mots génériques écartés, nom à trait d'union gardé entier, replié sans accents) et `checkPlaceNames` bloque un texte public qui en contient un, mot entier ou expression, même masqué par des chiffres (code `place_named`). Branchée dans `publicWriterPersona`, donc commune aux posts du canal Telegram, aux réponses aux commentaires Instagram et aux légendes de Reel quand #996 arrive. ADR 0080 amendée (§ 5.9), code ajouté à `GUARD_CODES` avec son libellé, glossaire.
Pas fait : un mot dérivé d'un nom (« valbrumoise ») n'est pas attrapé ; le prompt reste chargé de ne nommer aucun lieu. Les lieux de `traveling` (texte long) ne sont pas lus.
Décisions : son pays n'est pas lu (il ne désigne personne, et elle peut le dire en public). Validée par le fil Bilan, menée par le fil Agent.
Découvertes : `commentWriterPersona` n'est encore branché par aucun module ; `captionWriterPersona` (#996) recevra la garde sans changement.
Candidats à suppression : aucun.
Vérifié : tests unitaires de la garde, du balayage des codes et des deux personas publiques (canal, commentaires) ; typecheck, lint.
