# EQ-21 Rappel du rapport de fin de shift sur le téléphone du chatteur
Statut : in_progress (ADR 0077 acceptée par Charles le 06/11/2026 : « ok 0077 » 19 h 10, « ok rappel-double » et « ok rappel-de-nuit » 18 h 55)
Phase : équipe (ADR 0023, ADR 0042 § 7, ADR 0077)
Dépend de : CR-01 (notifications push), EQ-03 (rapports), ADR 0073
Branche : claude/project-thread-cohhca

## Objectif
Un chatteur qui oublie son rapport de fin de shift est prévenu sur son téléphone, sans que l'agence ait à le relancer à la main : 15 minutes après la fin du shift, même la nuit, puis 12 heures après.

## Contexte à lire
ADR 0077, ADR 0042 § 7, `apps/api/src/modules/notifications/README.md`, `apps/api/src/modules/scheduling/README.md` (rapports, ADR 0073).

## À faire
- [x] Raison `own_shift_end` (contrat, CHECK de la base, migration 0136 : NOT VALID puis VALIDATE) ; `PASSES_QUIET_HOURS` dans `policy.ts`, lu par `isCapped` et `decideNotification`.
- [x] Règle pure et message (`domain/report-reminders.ts`) : fenêtres, exclusions, heures dans le fuseau du membre, rien qui nomme la créatrice ni un fan.
- [x] Job `scheduling.remind_reports` toutes les cinq minutes (`crontab.ts`), candidats lus par pages en admin, shift relu juste avant de sonner ; `notify` donné par le composition root.
- [x] Tests : règle et message (unitaires), job (unitaire), job contre la base (rappels dus, annulé, rapport fait, source détectée, sans règles, membre parti, rejoué, rapport envoyé au dernier moment).
- [x] ADR, glossaire (« Heures calmes », « Rappel du rapport »), README de `scheduling` et de `notifications`.
- [ ] Pousser après la fusion de #624 (une session, une branche), migration régénérée après la 0135 de Bilan (#626), relecture de `policy.ts` par Bilan.

## Critères d'acceptation
- Un shift fini sans rapport sonne une fois à 15 minutes et une fois à 12 heures, jamais en double, et rien hors des fenêtres.
- Aucun écran nouveau : le chatteur active les notifications depuis le menu de son compte, comme aujourd'hui.
