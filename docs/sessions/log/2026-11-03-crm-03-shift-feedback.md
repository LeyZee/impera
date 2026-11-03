# 2026-11-03 — CRM-03 : mini feedback de fin de shift — done
Fait :
- Contrat `shift-feedback.ts` : commentaire, incident, jusqu'à 5 remontées (`fan_request`, `missing_script`, `missing_content`, `other`) ou « rien à signaler », jamais les deux ni rien ; un texte vide vaut rien.
- Table `shift_feedbacks` (migration 0073) : une ligne par shift, RLS (le membre écrit le sien ; le membre, le propriétaire et un manager actif lisent), ajout seul (déclencheur `shift_feedbacks_append_only`), sans aucun montant.
- `GET`/`PUT /v1/scheduling/shifts/:shiftId/feedback` : seul le membre du shift, dès 30 minutes avant la fin, sur un shift non annulé, sur une quinzaine `detected` (sinon le rapport est dû) ; rejouer le même feedback rend 200, un autre est refusé.
- `RulesRowSchema` déplacé dans `infra/rows.ts`, partagé par les rapports et le feedback.
Pas fait : l'affichage des ventes en lecture seule et l'écran au téléphone (Extension), le rappel d'un feedback manquant, les remontées vers le manager (CRM-05).
Décisions : le feedback vit dans `scheduling` à côté du rapport, parce qu'il le remplace sur une quinzaine `detected` et lit les mêmes règles ; la paie ne le lit pas, donc un feedback manquant ne change aucun montant.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `scheduling-feedback.integration.test.ts` (6 tests), domaine `reports.test.ts` (2 nouveaux), contrats `shift-feedback.test.ts` (4) ; drift Drizzle aligné.
