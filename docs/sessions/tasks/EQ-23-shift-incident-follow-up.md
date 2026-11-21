# EQ-23 Retour de fin de shift et suivi de ses incidents
Statut : in_review (trous béants n° 1, validé par Charles le 21/11/2026 : « attaque les 18 »)
Phase : équipe (ADR 0050 § 10, ADR 0043 § 2)
Dépend de : EQ-03 (rapports), CR-01 (notifications push)
Branche : claude/project-thread-cohhca-shift-feedback

## Objectif
Sur un compte dont la paie lit les ventes relevées, le chatteur fait son mini feedback depuis l'écran (il n'en avait pas : « Rien à déclarer »). Un incident prévient tout de suite le propriétaire et les managers actifs sur leur téléphone, se lit en tête d'Équipe › Rapports, et revient au chatteur en « Vu » puis « Réglé ».

## À faire
- [x] Table `shift_incident_steps` en ajout seul (FORCE RLS, refuse_change, lecture seule pour le rôle de service), migration provisoire 0255 à renuméroter au train.
- [x] Job `scheduling.notify_incident` mis en file dans la transaction du feedback ; message pur `incidentNotices` : qui et où, jamais le texte de l'incident.
- [x] `GET /v1/scheduling/shift-feedback` (une quinzaine, ou les incidents non réglés) et `POST /v1/scheduling/shift-feedback/:id/incident` (« Vu », « Réglé », jamais sur son propre incident, journalisé).
- [x] Écrans : panneau « Mon retour de fin de shift » (rien à signaler en un geste, mot, incident, remontées en couleur) ; carte rouge « Incidents à suivre » en tête d'Équipe › Rapports ; carte « Retours de fin de shift » de la quinzaine.
- [x] Tests : unitaires (message), intégration (droits, liste, étapes idempotentes, job), écran (formulaire, piste, carte).
- [ ] Captures validées par Design ; OK de Sécurité sur les droits de la nouvelle route.

## Plafond du rôle de service
`modules/scheduling` passe de 28 à 29 : l'alerte d'incident lit, sous withAdmin, les faits du feedback et ses destinataires (propriétaires, managers actifs de la créatrice), hors de toute requête d'un membre. Lecture seule, à relire par Sécurité.

## Reste
L'incident d'un rapport déclaré (`shift_report.incident`) ne sonne pas encore : il se lit avec le rapport à valider.
