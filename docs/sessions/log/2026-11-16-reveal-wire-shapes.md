# 2026-11-16 — Connecteur Reveal : formes des réponses du 15/11 — review

Fiche : aucune (correctif demandé par la coordination après la première lecture réelle du coffre). Branche : `task/reveal-wire-shapes`.
Fait : `wire.ts` accepte les formes relevées le 15/11 en lecture seule sur le PC (champs devenus absents, `model` dans `lastMessageAuthor`, `gif`, `refundAskedTotal`, remise d'étape, `endCursor` vide lu comme `null`) et refuse toujours une clé inconnue ; `mediaType=All` envoyé par défaut sur le coffre, `Audio` pour le vocal ; FakeReveal exige `mediaType` comme Reveal ; fourchette de prix PPV inconnue (`null`) quand Reveal ne la donne plus ; tests de ces formes en valeurs inventées.
Pas fait : un enregistrement anonymisé du 15/11 (aucune capture HAR faite, les formes viennent d'un relevé de schéma) ; la remise d'étape n'est que lue, jamais appliquée ni montrée.
Décisions : aucune nouvelle.
Découvertes : une première lecture des conversations sans `since` dépasse 500 pages sur un gros compte (`MAX_PAGES`) ; notifications refusées au membre « bot » (le connecteur ne les lit pas).
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests unitaires ; intégration en CI.
