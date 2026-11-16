# 2026-11-16 — Le brouillon retouché garde ses frappes dans le panneau (recette EXT-01) — fait

**Session** : Extension et playground · **Branche** : `claude/extension-reveal-playground-45axcj`

Fait : dans le panneau copilote, « Retoucher » (E) ouvre un champ que la relecture de la fiche toutes les 5 s redessinait en entier : le champ était recréé, il perdait le focus, et les frappes suivantes partaient sur la page. Le brouillon déjà dessiné reste désormais en place tant que son état ne change pas (le texte retouché n'entre plus dans la comparaison) : le champ garde son focus, son texte et son curseur pendant que la fiche au-dessus se redessine. La note d'un refus garde aussi son focus.
Pas fait : le reste de la recette de l'extension (EXT-02 à EXT-27), en PR séparées.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : test qui échoue sans la correction et passe avec, pnpm check, pnpm test (pre-push).
