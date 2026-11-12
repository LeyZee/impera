# 2026-11-11 · Rapports en attente d'une quinzaine basculée : « Sans effet sur la paie » (CRM-03, ADR 0084 § 3)

Fait :
- Choix de Charles (carte du fil recette paie, 11/11 17 h 33) : « Sans effet, hors liste ».
- Contrat : `earningsSource` sur `ShiftReportSchema`, la source des règles du compte à la quinzaine du rapport ; la liste ouverte, la validation et le renvoi documentent le cas.
- `scheduling` :
  - `earningsSourceFor` et `assertDecidable` (domaine) ;
  - le store attache la source à chaque rapport lu, sort ces rapports de la liste ouverte, retire de la liste d'une quinzaine les shifts sans rapport dont la quinzaine lit les ventes, refuse de valider ou renvoyer, et laisse ces rapports hors du contrôle automatique (`reportSource`) ;
  - `reportsAwaitingReviewScoped` ne les compte plus : ils ne bloquent jamais une clôture ;
  - `canReview` est faux pour eux.
- Écrans : `withoutPayEffect`, `toneOf`, `memberStatusOf`, `agencyStatusOf` ; « Sans effet sur la paie » en gris dans Équipe › Rapports (quinzaine), la fiche du shift, Aujourd'hui, Mes rapports, Mon planning et la fenêtre du rapport ; hors des totaux, du « À faire » et de la garde de Paie › Quinzaine ; pas de « Corriger » sur eux.
- Tests :
  - unitaires du domaine (`reports.test.ts`) et du modèle web ;
  - intégration `scheduling-reports` : rapport envoyé et rapport renvoyé sur une quinzaine basculée, hors liste ouverte et hors décompte de clôture, visibles « detected » dans leur quinzaine, refus de valider, renvoyer et renvoyer à nouveau, plus de ligne « Sans rapport » ;
  - écrans : Équipe › Rapports, Mes rapports, la fenêtre du rapport.

Vérifié : `pnpm check`, tests unitaires et d'intégration des rapports et de la paie verts.

Captures : 12 images Nuit/Jour, PC/téléphone (Équipe › Rapports, Mes rapports, la fenêtre du rapport), bac à sable, comptes inventés.

Reste : relecture par le fil recette paie, qui rejoue le cas dans le bac à sable ; « ok captures » de Charles.

Découvertes : sur un compte `detected` d'une plateforme sans net (cas que l'écran des règles ne crée pas), #688 compte les rapports validés (base `gross_chain`) alors que ces écrans les disent sans effet.
- Sur un shift en cours d'un compte dont la quinzaine lit les ventes, Aujourd'hui annonce « Rapport à partir de 21 h 30 » puis « Faire mon rapport », qui ouvre « Rien à déclarer » : le mini retour de l'ADR 0050 § 10 a sa route (`/scheduling/shifts/:shiftId/feedback`) mais aucun écran.
