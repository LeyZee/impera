# 2026-11-02 — lot 8, complément 4 : le délai de rappel des pièces en écriture (fil Équipe) — in_progress
Fait : `PUT /v1/payroll/billing-settings` prend `documentReminderDays` (1 à 120 jours entiers), facultatif : omis, le délai enregistré est gardé, 30 jours au premier enregistrement. Changé, `audit_log` le nomme dans `billing_settings.update` comme les autres champs, sans valeur ; changé seul, il ne relance aucune facture (`payroll.requeue_invoice_issues` n'est mis en file que si un autre champ change). Doc : README de la paie, fiches EQ-06.
Pas fait : le complément 3 (l'alerte d'échéance) ; le champ à l'écran (Extension, 8c).
Décisions : facultatif plutôt qu'exigé, pour que l'écran de Réglages › Facturation déjà en service continue d'enregistrer sans lui jusqu'au lot 8c ; le délai ne relance pas l'émission, qu'il ne débloque jamais ; le job de rappel le lit à son passage horaire suivant, rien n'est mis en file. Sans migration ni ADR.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : contrats (facultatif, 1 à 120 entiers) ✓ ; intégration `payroll-billing-settings` contre Postgres 16 (30 par défaut, 45 enregistré et nommé seul dans l'audit, aucune relance, omis ou identique sans écriture, 0, 121 et 7,5 refusés, retour à 30) ✓ ; `payroll-document-reminders` ✓.
