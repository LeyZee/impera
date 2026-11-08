# 2026-11-08 — ADR 0084 : la quinzaine vérifiée peut être la première payée sur les ventes Reveal (CRM-03)

Fait :
- ADR 0084, acceptée par Charles (« ok novembre-reveal » 16 h 29, « ok 0084 » 16 h 46). Elle amende l'ADR 0050 § 8 et la règle de départ des règles de paie d'EQ-03.
- Contrats :
  - `period_closed` dans `PAY_RULES_SOURCE_REFUSALS` ;
  - `checkedPeriod` par compte dans `AccountPayRulesListSchema`.
- `scheduling` :
  - `assertRulesStart` prend la source et la quinzaine vérifiée (`checkedPeriodOf`, `switchablePeriodOf`) ;
  - `assertSourceSwitchable` accepte la quinzaine vérifiée elle-même ;
  - le store lit le fait « quinzaine clôturée depuis » chez `payroll` (`payReadsForPayRules.closedFrom`, câblé par `wiring/scheduling.ts`) ;
  - le store met en file `payroll.recalculate` pour chaque quinzaine commencée que les règles touchent.
- Écran Réglages › Règles de paie :
  - « Ventes relevées » est ouvert pour une plateforme qui donne un net, et la source vient en premier dans la fenêtre ;
  - la quinzaine vérifiée est proposée (« vérifiée ») et choisie d'office avec « Ventes relevées », tant que le propriétaire n'en prend pas une autre ;
  - le récapitulatif prévient du recalcul ;
  - la carte du compte dit « Ventes vérifiées » ; la colonne des pastilles s'élargit sur cette carte pour que la pastille ne mange pas la phrase (vu en capture).
- Tests :
  - unitaires `pay-rules` ;
  - intégration `scheduling-reports` : quinzaine vérifiée acceptée et recalculée, rapports refusés sur elle, quinzaine d'avant refusée, quinzaine clôturée refusée, rien pour un manager ;
  - écran `PayRulesSection` : bascule, retour aux rapports, plateforme sans net, refus `period_closed`.

État de la base de Charles le 08/11, lu sans écriture : un compte Reveal, aucune règle de paie, aucune clôture, aucun shift en novembre, aucun chatteur relié, aucune vérification ; 13 ventes du 3 au 6 novembre ; CRM arrêté depuis le 06/11 au soir. Son clone est à jour sur main c38159c4 (migrations 0137 et 0138).

Captures sur la pile 3 du bac à sable (Nuit/Jour, ordinateur/téléphone) : carte, fenêtre, récapitulatif.

Reste : validation des captures par Charles, relectures de Bilan (garde, contrat) et d'Extension (écran), fusion. Côté Charles, pour novembre : relancer le CRM, relier les chatteurs, saisir les shifts de novembre, vérifier du 1er au 15 le 16/11 avec l'export, puis poser les règles à partir du 1er novembre.

Découvertes : dans le design system, `.nv-chip:hover:not(:disabled)` l'emporte sur `.nv-chip[aria-checked='true']` (spécificité plus forte). Une pastille cochée sous le pointeur perd son fond plein, et sur téléphone le survol reste après le toucher : on croit que le choix n'a pas pris. Toutes les pastilles de choix sont touchées. À traiter par le propriétaire du design system.
