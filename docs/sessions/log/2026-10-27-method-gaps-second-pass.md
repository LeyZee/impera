# 2026-10-27 — Écarts méthode / code, seconde passe — done

Fait : passe de la méthode de chatting qui fait foi contre le code sur main 5a3e09d (après #194, #200, #207). Le tableau de `PROPOSED-method-gaps.md` est mis à jour : sécurité, relation, KYC et sexualisation sont appliqués ; ce qui reste tourne autour des offres. Nouvelle fiche proposée `PROPOSED-after-offer.md` (rythme des offres, refus et bouderie, aftercare, aide au paiement, relances de vente), qui dépend de P6-01. Le commentaire de `holdDecision` promettait une relance après « attends, je reviens » qui n'existe pas : corrigé.

Pas fait : rien de la passe.

Décisions : les réglages « offres par jour » et « offres sans achat » ne sont dans aucune fiche ; ils entrent dans la fiche proposée.

Découvertes : aucune relance n'est programmée quand le cerveau choisit d'attendre, et rien n'alerte l'opérateur dans ce cas (worker et « À traiter », zone Bilan).

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`.
