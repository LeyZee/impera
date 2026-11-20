# 2026-11-19 — CHF-01, ADR 0118 § 7 : le dévoilement d'un rang dit le seuil passé — in_progress
Fait : la vitrine lue par le chatteur lui-même porte, pour un rang, le seuil auquel il a été gagné (champ facultatif `basis`, absent pour un autre lecteur et pour un rang noté sans seuil gardé) ; le dévoilement dit « Ton net depuis ton arrivée vient de passer 5 000 €. » et garde l'ancienne phrase sans ce champ ; une ligne sur `nv-tip__aside` dans le README du design (demande de Design sur la PR précédente).
Pas fait : le récapitulatif de dévoilement au-delà de deux gains (CHT-09) ; les jauges animées depuis la dernière valeur vue ; le lot 3.
Décisions : aucune nouvelle ; précision ajoutée à l'ADR 0118 § 7.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
