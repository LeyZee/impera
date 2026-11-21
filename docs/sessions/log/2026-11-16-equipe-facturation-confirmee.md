# 2026-11-16 — Équipe : confirmation sur les gestes de facturation (EQ-15, recette de l'espace agence)
Fait : la confirmation récente (mot de passe et code de moins de 10 minutes) sur les écritures de facturation du propriétaire (réglages, comptes, textes, régimes, dossier d'un prestataire, pièces, fin d'une contestation) et du membre sur son propre dossier (identité et coordonnées, pièces, acceptation d'un texte, contestation), et sur le seuil d'écart des rapports ; test d'intégration qui liste ces routes et celles laissées libres ; côté écran, `useConfirmedWrite` montre la demande commune à la place du formulaire ou des boutons et rejoue le même geste.
Pas fait : la défense en base des décisions de vente, les droits du manager sur l'autre manager, les préréglages, le retrait d'une créatrice qui a des shifts, le membre suspendu compté couvert et les points mineurs de la recette viennent dans les PR suivantes.
Décisions : de Charles (16/11) : « J'accepte » sur une facture reste sans mot de passe ; la contestation en demande un. Aucune décision structurante nouvelle (ADR 0046 § 3).
Découvertes : transmises au coordinateur.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test, pnpm test:integration (Postgres local).
