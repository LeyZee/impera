# CR-09 Contrôle du rapport de fin de shift et validation automatique par les ventes de Reveal
Statut : todo pour les signaux ; blocked pour le rapprochement (lecture des ventes de Reveal) (ADR 0043 § 4 et § 5, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0043)
Dépend de : CR-03 ; pour le rapprochement, le connecteur Reveal (`listTransactions`) et l'attribution des ventes (EQ-08)
Branche : task/cr-09-report-check

## Objectif
Le code marque chaque rapport (doublon possible, total inhabituel) et, dès que Reveal est lu, le rapproche des ventes réelles : en dessous et dans le seuil il est validé seul, sinon il passe en ambre « écart » chez le manager.

## Contexte à lire
`docs/adr/0043-chatter-sale-entries-and-report-check.md`, ADR 0023 (§ Une seule source), 0025 (marge d'accès), EQ-03, EQ-08.

## À faire
- [ ] Signal permanent (ADR 0049 § 3) : même fan et même montant déclarés par deux membres du même compte à moins de 10 minutes d'écart, signalé sur les deux rapports ; les rapports d'une présence commune passent au valideur côte à côte ; une fois les fans confiés, une vente saisie pour un fan confié à un autre membre est signalée.
- [ ] `report_check`, fonction pure : signaux toujours actifs (bonne créatrice et bon shift, même fan et même montant sous 10 minutes, total au-delà de trois fois la médiane du membre sur 30 jours, seulement avec au moins 5 shifts sur ces 30 jours ; sans cet historique, pas de signal « total inhabituel »).
- [ ] Réglages de l'agence : seuils d'écart (5 % et 10 € par défaut).
- [ ] Rapprochement : ventes de Reveal sur la fenêtre du shift (début, fin plus la marge), aux seules ventes attribuées au membre selon l'ADR 0025 ; une vente sans attribution envoie le rapport au valideur ; rapprochement ligne par ligne (fan, montant).
- [ ] Chemin de la validation automatique (migration de Bilan) : la politique `team_review` de `shift_reports` (migration 0026) exige `reviewed_by = app.user_id` et un valideur qui n'est pas l'auteur, donc le « contrôle automatique » n'a aucun chemin aujourd'hui. Il valide par un job, sur la connexion admin, avec une marque explicite (par exemple `reviewed_by` nul et un genre de revue `automatic`) qui nomme la version contrôlée ; **jamais un utilisateur inventé**, et aucun membre ne peut poser cette marque.
- [ ] Validation automatique seulement pour un rapport **en dessous** des ventes attribuées de Reveal et dans le seuil, au nom du « contrôle automatique », au journal, sous le verrou (membre, période) ; un rapport au-dessus, au-delà du seuil ou avec une vente sans attribution passe en ambre « écart », avec les deux sommes et le rapprochement (option A, Charles, 02/11 16h30).
- [ ] Sans lecture des ventes de Reveal : jamais de validation automatique, les signaux seulement devant le valideur.
- [ ] Passage d'un compte en source « détectée » à une frontière de période ; la saisie disparaît pour ce compte.

## Critères d'acceptation
- Test RLS : aucun membre, propriétaire compris, ne pose la marque de la validation automatique ; une validation automatique d'une version dépassée est refusée.
- Tests : chatteur nouveau (moins de 5 shifts sur 30 jours) sans signal « total inhabituel », écart exactement au seuil, au-delà, rapport au-dessus de Reveal même de 1 centime jamais validé seul, vente de Reveal hors fenêtre, vente sans attribution envoyée au valideur, vente de l'agent ou du chatteur suivant jamais comptée, compte non lu jamais validé seul, validation automatique rejouée sans doublon.

## Hors périmètre
Les retours de l'IA (CR-10).

## Notes de session
