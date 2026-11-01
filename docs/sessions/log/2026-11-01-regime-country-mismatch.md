# 2026-11-01 — EQ-06 : le régime du pays de la fiche à l'émission, « ok pays » (fil Équipe) — done
Fait : sans migration. À l'émission d'une facture de relevé, le régime du jour doit être écrit pour le pays de la fiche du membre ce jour-là, sinon `regime_country_mismatch` (après `regime_not_validated`, avant l'identité), dit une fois au propriétaire avec son texte Telegram. Un avoir et une facture rectificative gardent le régime de la facture citée. Doc : README de la paie, EQ-06.
Pas fait : rien de plus sur ce point ; le lot 5c-2 et les écrans restent. Fusionné par #356. La note de Bilan (une fiche revenue au pays de son régime ne relançait rien) est traitée au lot 5c-2 par une relance quotidienne.
Décisions : la règle se lit à l'émission, pas seulement à l'attribution, pour qu'une fiche changée de pays ensuite n'imprime jamais les mentions et la TVA d'un autre pays ; la copie du régime sur la facture reste sans pays.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires (domaine : l'ordre des motifs, la paire d'annulation qui part quand la facture du jour attend) ✓ ; tests d'intégration `payroll-regimes` (le changement de pays bloque, le retour émet), `payroll-invoices`, `payroll-documents`, `payroll-contractors`, `payroll-validation` contre Postgres 16 ✓ ; le test échoue sans la règle ✓.
