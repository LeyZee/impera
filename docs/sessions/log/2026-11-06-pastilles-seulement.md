# 2026-11-06 — Pastilles seulement : plus de trait de couleur au bord d'une carte ou d'un créneau

Fait : les derniers traits de 3 px sur le bord d'une carte ou d'un créneau sont retirés, puisque Charles veut des pastilles seulement.
- Une facture en retard ou bientôt due garde sa pastille « En retard » ou « Bientôt due ».
- Une pièce à renouveler dans Moi › Dossier garde son texte ambre.
- Un régime de facturation à valider garde « À valider » et « Pas encore notée ».
- « IA seule » dans l'agenda garde son fond et son mot violets.
- Sur la grille, un shift qui gêne un congé à valider garde son anneau ambre.

Le bouton PDF d'une facture est `aria-disabled` pendant sa lecture et une fois son PDF perdu, jamais `disabled`. Pressé à l'Entrée, il garde le focus au lieu de le rendre à la page (point d'Extension sur #567).

Le pli « 1 congé à valider » d'Équipe › Planning s'ouvre de nouveau en colonne : le résumé en haut, les congés dessous. Il portait `.sc-decide`, que #546 a donné ensuite à « À décider » sur l'Aujourd'hui de la créatrice, une ligne flexible qui posait le résumé à côté des congés et les coupait sur téléphone. Il prend sa propre classe, `.sc-fold--decide`.

Pas fait : rien.

Décisions : un état se dit par une pastille, un mot ou un anneau, jamais par un bord coloré. Deux traits restent, parce qu'ils ne portent ni couleur ni état : le trait neutre de la citation (« Désignation de la prestation ») et les filets neutres des étapes d'une facture.

Découvertes : quand l'agent répond aussi pendant un shift, un trait violet de 2 px reste à droite du créneau (`.cal-slot[data-ai]::after`, ADR 0048), pointillé quand il n'en couvre qu'une part. La légende dit l'IA par une pastille, pas par un trait. La question de le remplacer par cette pastille est posée à Charles dans la PR, et rien n'est changé sans sa réponse. Les bordures gauches de `telegram.css` ne sont pas d'Équipe.

Candidats à suppression : aucun ; le banc de captures de `.scratch/` reste jusqu'à la dernière PR de la série.

Vérifié :
- tests : `MyInvoicesPage` (focus gardé, `aria-disabled` sans `disabled`, un clic sur un PDF perdu ne relit rien), `MyFilePage`, `LegalCards`, `PlanningPage` (le pli des congés n'a jamais `.sc-decide`) ;
- captures Nuit et Jour, ordinateur et téléphone, dans `/mnt/project-files/recette/2026-11-05/corrections/equipe/pastilles-seulement/`.
