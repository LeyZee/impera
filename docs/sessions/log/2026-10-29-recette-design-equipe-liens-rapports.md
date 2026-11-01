# 2026-10-29 — Recette design, Équipe › liens entre fiches et Rapports — done

Fait :
- EQ-11 : la fiche d'un membre mène à son travail. « Ses shifts » ouvre Planning avec ses shifts en avant, les autres atténués, et « Toute l'équipe » pour revenir. « Ses rapports » ouvre Rapports avec son pli ouvert. « Son relevé » ouvre Paie › Quinzaine sur son relevé, ou dit « Pas de relevé de … sur cette quinzaine ». Dans la fiche d'un shift, son nom ouvre sa fiche. L'adresse garde `?membre=` sur Planning, Rapports et Paie. Les liens du panneau de statut (#318) vers les shifts restants d'un membre absent ou parti passent aussi par ce filtre.
- EQ-13 : dans la fiche d'un shift fini, « Sans rapport » ou le statut du rapport mène à son pli de la quinzaine dans Rapports. La phrase « Ce shift est fini… » est retirée.
- EQ-14 : sous le compte « À valider », le pli « N shifts sans rapport » donne le membre, le shift et « depuis 8 h », le plus ancien en premier. Il couvre la quinzaine en cours et la précédente. Dans la ligne d'un membre, seul « N sans rapport » est ambre.
- EQ-15 : « Relancer » copie le mot prêt pour WhatsApp, aux heures du membre. Sans presse-papiers, le mot s'affiche pour une copie à la main. Il est sur chaque shift sans rapport, dans le pli et dans les lignes de quinzaine.
- EQ-21 : un rapport envoyé se dit « En attente » chez le membre, comme le chiffre au-dessus. Les libellés en casse de phrase étaient déjà faits par DASH-24.
- EQ-26 : « Valider (N) » n'apparaît qu'avec une sélection. Il est au pied de la liste qu'il valide, dans une barre qui reste en vue, et plus dans l'en-tête.

Décisions :
- Les trois liens de la fiche sont sous ses faits, au-dessus de l'accès et des notes, et non tout en bas, où les notes qui s'allongent les pousseraient hors de vue.
- « Relancer » copie toujours, sans passer par la feuille de partage : le geste est le même sur ordinateur et sur téléphone.

Relecture (Extension, Équipe) :
- Le bandeau « Ses shifts » prend le nom dans l'équipe : le planning ne nomme que les membres qui ont un shift ou un modèle dans la semaine. « Toute l'équipe » rend le focus au sélecteur de semaine. Le bandeau est un repère, sans `role="status"`.
- Le pli des shifts sans rapport dit sa fenêtre, « cette quinzaine et la précédente ». Un rapport tardif n'est jamais refusé, puisque la paie le porte sur la première quinzaine ouverte (ADR 0023). Si une des deux lectures échoue, une ligne ambre avec « Réessayer » prend la place du pli.
- « Relancer » prend les heures du membre, lues dans l'équipe. Si l'équipe ne se lit pas, une ligne ambre le dit et le bouton attend. Un membre parti ne peut plus se connecter : sa ligne dit « Parti », sans mot à copier.
- « Message copié » s’annonce dans une seule zone de statut pour la page, toujours montée, avec le shift : une seconde copie pour le même membre est annoncée aussi. Sans presse-papiers, le mot s'affiche dans un champ en lecture seule, déjà sélectionné.
- Rapports avec `?membre=` dit « Pas de shift de … sur cette quinzaine » pour un membre sans shift. « Pas de relevé de … » (Paie) n'est plus une zone de statut.
- Le prénom d'exemple du glossaire vient des fixtures (Kofi).

Découvertes : une lecture serveur de tous les shifts finis sans rapport, toutes quinzaines confondues, est côté API. Le pli d'EQ-14 lit aujourd'hui deux quinzaines.
Candidats à suppression : aucun.
Vérifié :
- `pnpm check` ✓, tests web ✓ : liens et adresses, focus du planning, pli ouvert, shifts sans rapport et mot copié, relevé ouvert ou absent, barre de validation.
- Captures nuit 1440 et 390.
