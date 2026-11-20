# DSH-07 Le Dashboard de l'agence liste les remboursements un par un
Statut : in-progress
Phase : pilotage
Dépend de : DSH-01 (ADR 0078), DSH-06
Branche : claude/project-thread-v704ot
Propriétaire : fil « Compléter le Dashboard de l'agence » ; relecteurs Bilan (contrat, connecteurs, supervision), Design (apps/web)

## Objectif
Appliquer l'ADR 0092 § 4 : au lieu d'un seul compteur, la liste des remboursements de la période avec la date, la créatrice, le type, le montant, le chatteur de la vente et le délai depuis la vente. Lecture seule, filtres par créatrice et par chatteur.

## Contexte à lire
ADR 0092 § 4, ADR 0078 (droits de lecture), ADR 0144 (le MCP ne voit jamais qui a vendu), README des connecteurs (totaux des ventes).

## À faire
- [x] Connecteurs : `refundsListed` (pur) et `salesFeedTotals.refundListOf`, les remboursements que les totaux retranchent, chacun sur le jour de sa vente ou sur le sien hors registre.
- [x] Contrat : `refundList` dans `AgencyInsightsSchema` (instant, créatrice, type, montant en centimes d'euro ou null pour un dollar sans taux, vendeur nommé, jours depuis la vente ou null).
- [x] Supervision : lecture dans le tenant de chaque créatrice, mêmes droits que « Qui a vendu » ; le MCP ne la recopie pas (test).
- [x] Écran : carte « Les remboursements » sous « Les fans qui paient », tableau sur ordinateur, une fiche par remboursement au téléphone, filtres en listes du design system ; rien quand la période n'en a pas.
- [x] Tests : domaine des connecteurs et de la supervision, intégration de la route, MCP, écran.
- [x] Captures Nuit/Jour, PC/téléphone, données inventées ; avis Design, puis « ok captures dashboard-remboursements-1 » de Charles le 20/11.
- [ ] OK de Bilan (serveur, contrat) et de Design (écran) sur le dernier commit.

## Critères d'acceptation
- Le nombre de lignes égale le compteur « Remboursements » plus les remboursements hors registre de la période.
- Aucun fan, jamais ; aucun champ de la liste dans la réponse du MCP.
- Aucune valeur réelle dans les tests, la doc ou les captures.

## Hors périmètre
Les objectifs mensuels (§ 6, DSH-08).
