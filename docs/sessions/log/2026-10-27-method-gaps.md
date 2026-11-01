# 2026-10-27 — Écarts entre la méthode de chatting et le code : fiche proposée — done

Fait : fiche `docs/sessions/tasks/PROPOSED-method-gaps.md`. Chaque règle de la méthode (reformulée, aucun extrait) est confrontée au code de l'agent : appliquée, partielle, manquante ou appliquée autrement, avec fichier et test.

Pas fait : aucun code dans cette PR. Les corrections de la zone agent partent dans une PR à part.

Décisions : aucune.

Découvertes : `offerDecision` n'est appelé que par les évals, le manque d'argent n'est pas gardé d'un message à l'autre, `maySulk` et `offerableScripts` n'ont pas d'appelant, le curseur de sexualisation, le minimum de KYC, `follow_ups` et `post_offer.delay_days` ne sont lus nulle part.

Candidats à suppression : aucun.

Vérifié : `pnpm check`.
