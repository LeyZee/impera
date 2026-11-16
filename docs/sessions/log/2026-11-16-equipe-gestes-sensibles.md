# 2026-11-16 — Équipe : confirmation sur les gestes de membre, de taux et de paie (EQ-15, recette de l'espace agence)
Fait : la confirmation récente (mot de passe et code de moins de 10 minutes) sur les écritures d'un membre, d'un taux et de la paie, avec un test d'intégration qui liste les routes ; côté écran, `useConfirmAgain` montre la boîte commune `PasswordPrompt` à la place des boutons et rejoue le même geste (quinzaine, saisies, objectifs et paliers, minimum et délai de versement, paiement, fiche du membre, règles de paie, pourcentage de l'agence) ; la règle des quatre yeux compte aussi le receveur de la décision en vigueur d'une vente ; le taux absent de la fiche membre dit en mots, plus de tiret.
Pas fait : l'écran de création des préréglages, le retrait d'une créatrice qui a des shifts, le membre suspendu compté couvert et les points mineurs de la recette viennent dans les PR suivantes.
Décisions : aucune nouvelle (ADR 0046 § 3, ADR 0101).
Découvertes : transmises au coordinateur.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
