# CR-04 Gains et ventes de la créatrice, au jour le jour
Statut : in_progress, réglage du pourcentage fait (ADR 0042 § 6 et § 7, acceptée par Charles le 02/11/2026 ; ADR 0054 pour la source sur Reveal, acceptée le 03/11/2026)
Phase : espaces (ADR 0042)
Dépend de : CR-02, CR-03 ou CRM-04, EQ-01 (paramètres de plateforme)
Branche : task/cr-04-creator-earnings

## Objectif
La créatrice voit chaque vente (heure, montant, type, contenu, fan) et « ce qui part à toi », avec le parcours ligne par ligne, et reçoit une notification par vente. Elle ne voit jamais qui a vendu : ni chatteur, ni agent (Charles, 03/11/2026, « ok recos » sur la fiche CRM-04).

## Contexte à lire
`docs/adr/0042-creator-space.md` (§ 6, § 7), ADR 0011, 0023 (§ Paie : arrondis), 0033 (taux du jour), la lecture d'Imperium (parcours de l'argent et ses pièges, hors dépôt).

## À faire
- [x] Réglage par créatrice du pourcentage de l'agence, en points de base, daté, jamais appliqué en arrière, saisi par le propriétaire dans Créatrices ; aucun défaut : hors Reveal, sans réglage, « à régler » ; sur Reveal, sa part s'affiche même sans pourcentage, qui ne sert qu'au signal d'écart du propriétaire (ADR 0054 § 2, CRM-04 lot d). Fait par Équipe le 03/11/2026 : table `creator_agency_rates` (migration 0096), routes `/v1/creators/:creatorId/agency-rates`, onglet Créatrices › Pourcentage. La valeur réelle reste à saisir par Charles dans l'écran.
- [ ] Hors Reveal, fonction pure de la chaîne : brut TTC → hors TVA → net après commission → part de l'agence → part de la créatrice, par compte et par période, entiers, arrondi au centime après chaque étape, demi qui s'éloigne de zéro ; taux de change du jour de la vente. Sur Reveal, « Ta part » est `modelRevenue` (ADR 0050 § 8), sans recalcul.
- [ ] Route de lecture pour la créatrice (Aujourd'hui, quinzaine, mois, écart au mois précédent à la même date, objectif facultatif), « estimé » tant que la période n'est pas close. Source : sur Reveal, les chiffres de Reveal dès que son modèle est relié, que la paie du compte ait basculé ou non, avec la mention « lus chez Reveal » (recommandation 4 de la fiche CRM-04, acceptée par Charles le 03/11/2026 ; ADR 0054, qui remplace la phrase de l'ADR 0042 § 6 sur la source des ventes), par la vue `creator_sales` de CRM-04 lot d ; hors Reveal, les ventes saisies, comme la paie du compte.
- [ ] Écran Ventes : « Ta part » en grand, parcours ligne par ligne, liste des ventes, une unité de période par écran. Le fan n'est nommé que si Nirvana le connaît par sa fiche, sinon la vente reste sans nom.
- [ ] L'écran n'affiche que les lignes de la chaîne rendues par le serveur (brut, TVA, plateforme, agence, sa part) : aucun calcul d'argent dans le navigateur.
- [ ] Notification par vente, regroupées au-delà de 3 en 2 minutes, retenues pendant les heures calmes (CR-01). Elle montre sa part (`modelRevenue` sur Reveal, la chaîne ailleurs), jamais le chatteur ni l'agent. Sur Reveal, c'est fait par CRM-04 lot d2 (`notifications.creator_sale`) ; reste la vente saisie hors Reveal, avec la chaîne.
- [ ] Ni la route ni l'écran ne portent l'auteur d'une vente (membre, agent, chatteur non relié) : le contrat de lecture de la créatrice n'a pas ce champ, un test le vérifie.

## Critères d'acceptation
- Tests de la chaîne, hors Reveal : exemple d'Imperium (100 € à 20 % de TVA et 18 % de plateforme, agence 35 % → 44,42 €) retrouvé au centime ; changement de pourcentage au milieu d'une période ; aucun pourcentage → aucune part ; vente en dollars à son taux du jour.
- Tests sur Reveal : « Ta part » = la somme des `modelRevenue` de ses ventes, remboursements déduits, sans pourcentage d'agence ; la mention « lus chez Reveal » ; le même chiffre que celui de Reveal, que la paie du compte ait basculé ou non.
- Intégration : une créatrice ne lit que ses ventes.
- Finition : captures Nuit et Jour, téléphone et bureau.

## Hors périmètre
Facturation de la créatrice (pas sur Reveal) ; ventes détectées (connecteur).

## Notes de session
- 03/11/2026, Équipe, le réglage :
  - Le pourcentage vaut à partir d'un jour civil dans le fuseau de l'agence (celui des quinzaines), pas d'une quinzaine : la fiche demande un changement au milieu d'une période. Une vente prend le pourcentage en vigueur le jour de sa vente dans ce fuseau (`agencyRateFor`).
  - Jamais en arrière : demain au plus tôt. Le premier d'une créatrice peut partir d'aujourd'hui, comme les premières règles de paie d'un compte, puisque rien n'était montré avant lui. Une erreur se corrige par le suivant : l'écran fait lire la phrase entière avant l'envoi.
  - Lu et posé par le propriétaire seul. Le compte de la créatrice ne lit pas la table : son écran Ventes passera par le serveur (Chantier 7, 03/11).
  - Reste pour la chaîne hors Reveal : lire le pourcentage du jour de chaque vente ; pour CRM-04 lot d3 : le comparer à `modelRevenue`.
