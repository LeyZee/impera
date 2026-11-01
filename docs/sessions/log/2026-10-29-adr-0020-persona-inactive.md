# 2026-10-29 — ADR 0020 : la cause `persona_inactive` dans le tableau (Bilan) — done
Fait : le tableau des événements consommés de l'ADR 0020 range `persona_inactive` (ajoutée par #304) parmi les causes « important » de `handoff_requested`, ce que fait déjà le code (`telegram/domain/classify.ts` : toute cause non urgente part en important) ; le README du module `telegram` la nomme aussi. Reste de la recette complète.
Pas fait : rien.
Décisions : l'ADR 0020 est au statut `proposed` (index `docs/adr/README.md`), donc amendable : la ligne est complétée en place, sans nouvelle ADR, comme les lignes ajoutées depuis (0028, 0033).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`.
