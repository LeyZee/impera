# 2026-11-11 · Recette paie : rapports d'une quinzaine basculée comptés en double

Fait : `reportCountsOnPay` dans `payroll/domain/recalculation.ts` ; `reportsCounted`, la garde de `closePeriod` et celle de `validation-store.ts` ne comptent plus un rapport dont le compte lit le net de la plateforme à la quinzaine du rapport (ADR 0084 § 3).
Vérifié : 5 tests unitaires (quinzaine basculée, rapport en retard d'une quinzaine déclarée, pas de retour après clôture, quinzaine close inchangée, brouillon recalculé), `pnpm check` vert ; en bac à sable, le relevé du 16–31 octobre passe de 346,10 € de net (rapports + ventes) à 52,07 € (ventes seules) à la révision suivante, puis la clôture passe.
Reste : rapports « en attente » d'une quinzaine basculée (question à Charles).
Découvertes : voir le rapport de recette paie dans le dossier partagé du projet.
