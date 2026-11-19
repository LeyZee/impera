# 2026-11-19 — CHF-01, ADR 0118 § 10 : « Mes chiffres » lit les rapports validés, fiche « Jeu » — in_progress
Fait : « Mes chiffres » compte les shifts au rapport validé comme le jeu (jours, comparaison, records), avec un champ `reports` par jour ; l'écran les nomme « rapports validés » et ne les ajoute jamais aux ventes, « Quand je vends » ne lit que les ventes relevées ; une vente lue n'écarte le rapport d'un shift que sur le même compte (remarque d'Équipe sur la PR précédente) ; test d'intégration d'un compte dont la paie lit les ventes ; bloc « Jeu » de la fiche d'un membre redessiné, rang d'abord ; la bulle d'un jour se place à côté de sa barre et finit par une ligne discrète (`aside`) ; la note de fuseau dit la ville seule.
Pas fait : la phrase de dévoilement avec le montant du seuil ; le récapitulatif de dévoilement au-delà de deux gains (CHT-09) ; le lot 3.
Décisions : ADR 0118 § 10, accepté par Charles le 17/11/2026 avec le lot de captures.
Découvertes : la fiche créatrice de Badges gagnerait à reprendre le gabarit du bloc « Jeu » ; `db-tip-note` (ambre) vit dans la feuille du Dashboard et n'est pas chargé hors de lui.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
