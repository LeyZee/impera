# CR-04 Gains et ventes de la créatrice, au jour le jour
Statut : todo (ADR 0042 § 6 et § 7, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0042)
Dépend de : CR-02, CR-03, EQ-01 (paramètres de plateforme)
Branche : task/cr-04-creator-earnings

## Objectif
La créatrice voit chaque vente (heure, montant, type, contenu, fan, qui a vendu) et « ce qui part à toi », avec le parcours ligne par ligne, et reçoit une notification par vente.

## Contexte à lire
`docs/adr/0042-creator-space.md` (§ 6, § 7), ADR 0011, 0023 (§ Paie : arrondis), 0033 (taux du jour), la lecture d'Imperium (parcours de l'argent et ses pièges, hors dépôt).

## À faire
- [ ] Réglage par créatrice du pourcentage de l'agence, en points de base, daté, jamais appliqué en arrière, saisi par le propriétaire dans Créatrices ; aucun défaut : sans réglage, « à régler ».
- [ ] Fonction pure de la chaîne : brut TTC → hors TVA → net après commission → part de l'agence → part de la créatrice, par compte et par période, entiers, arrondi au centime après chaque étape, demi qui s'éloigne de zéro ; taux de change du jour de la vente.
- [ ] Route de lecture pour la créatrice (Aujourd'hui, quinzaine, mois, écart au mois précédent à la même date, objectif facultatif), « estimé » tant que la période n'est pas close ; source = celle de la paie du compte.
- [ ] Écran Ventes : « Ta part » en grand, parcours ligne par ligne, liste des ventes avec le fan, une unité de période par écran.
- [ ] L'écran n'affiche que les lignes de la chaîne rendues par le serveur (brut, TVA, plateforme, agence, sa part) : aucun calcul d'argent dans le navigateur.
- [ ] Notification par vente, regroupées au-delà de 3 en 2 minutes, retenues pendant les heures calmes (CR-01).

## Critères d'acceptation
- Tests : exemple d'Imperium (100 € sur Reveal à 20 % et 18 %, agence 35 % → 44,42 €) retrouvé au centime ; changement de pourcentage au milieu d'une période ; aucun pourcentage → aucune part ; vente en dollars à son taux du jour.
- Intégration : une créatrice ne lit que ses ventes.
- Finition : captures Nuit et Jour, téléphone et bureau.

## Hors périmètre
Facturation de la créatrice (pas sur Reveal) ; ventes détectées (connecteur).

## Notes de session
