# 2026-11-21 — Copilote lisible : la fiche et la vente en onglets
Fait : piste C choisie par Charles sur carte (« C, onglets »), avec les corrections de Design. Sous le cœur du panneau, cinq onglets (L'essentiel, Lui, Elle vue par lui, Intime, Vente) : une icône et un compte par onglet, le mot sur l'onglet ouvert seulement, touches 1 à 5 et flèches, point ambre là où attend une vérification. « Il ne veut pas » épinglé en ambre au-dessus de chaque onglet, lu même quand l'âge est contesté. Valeurs courtes (20 caractères au plus) en pastilles teintées de la couleur du groupe, valeurs longues en puces de la même couleur à 15 px ; source réduite à « deviné ». Prénom agrandi. Le panneau ouvre chaque conversation sur « L'essentiel ». Amendement de l'ADR 0086 (§ 13 à 16), qui change aussi la place de la vente (ADR 0141 § 14).
Pas fait : passer les pastilles sur `nv-tag--tint` de Design (PR #1008) avec une taille lisible, demandée à Design.
Décisions : l'onglet choisi tient pour la conversation en cours ; une autre conversation s'ouvre sur « L'essentiel ».
Découvertes : `groupLine`, `sourceLine` et `identitySources` ne servaient plus qu'au panneau replié ; retirés avec leurs tests.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓ ; extension 481 ✓.
