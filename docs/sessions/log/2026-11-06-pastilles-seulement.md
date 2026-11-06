# 2026-11-06 — Pastilles seulement : plus de trait de couleur au bord d'une carte ou d'un créneau

Fait : les derniers traits de 3 px sur le bord d'une carte ou d'un créneau sont retirés, puisque Charles veut des pastilles seulement.
- Une facture en retard ou bientôt due garde sa pastille « En retard » ou « Bientôt due ».
- Une pièce à renouveler dans Moi › Dossier garde son texte ambre.
- Un régime de facturation à valider garde « À valider » et « Pas encore notée ».
- « IA seule » dans l'agenda garde son fond et son mot violets.
- Sur la grille, un shift qui gêne un congé à valider garde son anneau ambre.

Le bouton PDF d'une facture est `aria-disabled` pendant sa lecture et une fois son PDF perdu, jamais `disabled`. Pressé à l'Entrée, il garde le focus au lieu de le rendre à la page (point d'Extension sur #567).

Le pli « 1 congé à valider » d'Équipe › Planning s'ouvre de nouveau en colonne : le résumé en haut, les congés dessous. Il portait `.sc-decide`, que #546 a donné ensuite à « À décider » sur l'Aujourd'hui de la créatrice, une ligne flexible qui posait le résumé à côté des congés et les coupait sur téléphone. Il prend sa propre classe, `.sc-fold--decide`.

« Attribuer un régime » (dossier d'un membre) propose les régimes de son pays en puces, jusqu'à cinq, comme le veut le design system (`nv-chip` pour quelques choix, `Select` au-delà). Au-delà de cinq, la liste d'Extension (#566) reste. Le mot sous les puces commence par une majuscule, puisque c'est une phrase à lui seul. Un choix refait ne tire pas de nouvelle clé d'idempotence.

Après le fil de captures, ces écrans sont repris :
- Les actions sans fond d'une facture (« PDF », « Historique ») et « Voir le fichier » d'une pièce ont un padding court. Leur mot reste sur le bord du texte, et leur anneau de focus est le contour de leur pastille, plus un grand ovale qui débordait vers le bord de la carte. Le PDF perdu grise son mot seul, pour que l'anneau reste entier.
- Sur téléphone, une facture tient sur une colonne, pareille pour toutes : le nom et les faits, le montant sur une ligne, les pastilles sur la leur, puis les actions. « Acceptée » et « Bientôt due » ne s'empilent plus à côté du montant.
- Sur téléphone, une pièce ou un texte du dossier partage sa première ligne avec sa pastille, et tout le reste prend la largeur de la carte. L'avertissement ambre n'est plus serré dans une colonne étroite.
- « IA seule » écrit son mot puis ses heures dessous, comme un shift et « À pourvoir » à côté.
- Le pli des congés à valider n'a plus de vide sous « 1 shift à donner avant de valider ». Sur téléphone, ses lignes sont sur le bord du résumé, et « Refuser » sur le bord du texte.
- Le banc de captures dit enfin la même chose que l'écran : la couverture d'un compte en Automatique (42 h « Chatteur et IA », 126 h « IA seule »), et des échéances cohérentes avec leurs dates.

Pas fait : la barre d'onglets de Paie sur téléphone montre un bout d'onglet coupé à gauche. `SubNav` est au design system d'Extension, à qui le fondu est signalé.

Décisions : un état se dit par une pastille, un mot ou un anneau, jamais par un bord coloré. Deux traits restent, parce qu'ils ne portent ni couleur ni état : le trait neutre de la citation (« Désignation de la prestation ») et les filets neutres des étapes d'une facture.

Découvertes : quand l'agent répond aussi pendant un shift, un trait violet de 2 px reste à droite du créneau (`.cal-slot[data-ai]::after`, ADR 0048), pointillé quand il n'en couvre qu'une part. La légende dit l'IA par une pastille, pas par un trait. La question de le remplacer par cette pastille est posée à Charles dans la PR, et rien n'est changé sans sa réponse. Les bordures gauches de `telegram.css` ne sont pas d'Équipe.

Candidats à suppression : aucun ; le banc de captures de `.scratch/` reste jusqu'à la dernière PR de la série.

Vérifié :
- tests : `MyInvoicesPage` (focus gardé, `aria-disabled` sans `disabled`, un clic sur un PDF perdu ne relit rien), `InvoicesPage` (une échéance sans `data-due`), `MyFilePage`, `LegalCards`, `PlanningPage` (le pli des congés n'a jamais `.sc-decide`), `MemberFilePage` (deux régimes en puces, six dans la liste) ;
- captures Nuit et Jour, ordinateur et téléphone, dans `/mnt/project-files/recette/2026-11-05/corrections/equipe/pastilles-seulement/`.
