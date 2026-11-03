# 2026-11-03 — CR-02 lot c1 : son accès, sur sa fiche — done
Fait : `GET /v1/creators/:creatorId/account` (propriétaire seul : aucun compte, invitée avec l'échéance du lien, ou entrée) et son contrat `CreatorAccountSchema` ; onglet Créatrices › Accès (`?onglet=acces`, ramené à Persona pour tout autre rôle) qui crée son compte et son lien avec son e-mail, puis remplace le lien ou en donne un de nouveau mot de passe ; `LinkShare` extrait de `ShareLink` pour servir membre et créatrice ; tests d'intégration (1 nouveau) et web (5 nouveaux) ; fiche CR-02.
Décisions : l'état de son accès se lit par une route à part plutôt que dans la liste des créatrices (lue par toute l'équipe) ; le lien créé reste affiché quand son compte change d'état, pour que le propriétaire ait le temps de le copier.
Pas fait : rail de la créatrice, Aujourd'hui, Moi (c2) ; Ventes › Fans et lecteur (c3).
Découvertes : aucune.
