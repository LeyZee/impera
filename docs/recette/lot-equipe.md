# Lot Équipe : membres, planning, rapports de shift, paie, factures, commissions

Zone : `apps/api/src/modules/team`, `scheduling`, `payroll`, `invoicing`, `accounting`, `contractors`, et leurs écrans (Équipe, Paie, Commissions, Planning du chatteur, Aujourd'hui du chatteur, Moi du membre, Créatrices › Heures et Pourcentage, Réglages › Règles de paie et Facturation, gains dans Ventes de la créatrice).

Données : le jeu de recette de Bilan, avec en plus deux chatteurs à la commission (15 % et 10 % ; un chatteur n'est jamais payé à l'heure, ADR 0023), un manager, une quinzaine close et une ouverte (le jeu de départ de Bilan n'a aucune quinzaine close : la clôturer en début de lot), et la créatrice « Lina Test » à **40 % d'agence** (jamais le vrai pourcentage). Chaque montant attendu est recalculé à la main dans le rapport.

## 1. Membres

| # | Parcours | Attendu |
|---|---|---|
| E1 | Ajouter un chatteur, un manager ; invitation ; premier accès | rail juste, dossier à remplir |
| E2 | Modifier taux, pays, mode de paie ; promouvoir ; suspendre ; départ | suspendu : accès restreint, shifts à venir signalés (EQP-03) ; parti : coupé, relevé final de la quinzaine du départ (ADR 0072) |
| E3 | Dossier d'un membre : pièces, résidence fiscale, refus, relance | `payroll.remind_documents`, `payroll.purge_refused_documents` ; versement bloqué dit vrai (EQP-04) |

## 2. Planning

| # | Parcours | Attendu |
|---|---|---|
| E4 | Équipe › Planning : poser, déplacer, supprimer un shift ; shift qui passe minuit ; changement d'heure (28/03/2027) | durées justes |
| E5 | Places, créneaux libres, fans partagés (ADR 0049) ; agent dans le calendrier (ADR 0048) | conforme |
| E6 | Échanges et congés : demander, accepter, refuser, laisser expirer (`scheduling.lapse_swaps`) | le shift échangé n'apparaît pas chez l'autre (CHAT-05) ; congé sur un jour avec shift prévenu |
| E7 | Lien de calendrier (Moi › Calendrier, lien partagé) | iCal valide, révocable |
| E8 | `scheduling.make_shifts`, `scheduling.check_agency_shares` deux fois | idempotents |

## 3. Rapports de fin de shift (ADR 0043, 0073, #615)

| # | Parcours | Attendu |
|---|---|---|
| E9 | Le chatteur fait son rapport depuis Aujourd'hui ; le manager fait le sien (EQP-02) | possible pour les deux |
| E10 | Rapport dans le seuil (≤ 1 % ou ≤ 5 €), pas au-dessus de Reveal | validé automatiquement par le job, une fois |
| E11 | Rapport au-dessus du seuil ou au-dessus de Reveal | bloqué 48 h puis au manager ; encadré d'écart « l'agence tranchera » ; jamais de retenue automatique |
| E12 | Totaux Reveal absents (pas de clé) | l'écran le dit, le rapport reste à valider à la main |
| E13 | Carte Dashboard « Rapports de fin de shift », bandeau Paie › Quinzaine, clôture refusée avec rapports en attente | 409 `pay_period_reports_pending_conflict` lu comme une phrase |

## 4. Paie

| # | Parcours | Attendu |
|---|---|---|
| E14 | Quinzaine : calcul sur le jeu de recette, paliers, objectif collectif, primes et malus | au centime, recalculé à la main |
| E15 | Malus au-dessus du plafond, total négatif ramené à zéro, 3 fautes non graves, faute grave | règles tranchées par Charles (11, 12, 15, 17) |
| E16 | Clôture : blocages (ambre), clôture, recalcul refusé, vente tardive après clôture | vente tardive dans la première quinzaine ouverte (ADR 0032) |
| E17 | Remboursement après validation | ligne négative tardive, ancien relevé intact (ADR 0050 § 7) |
| E18 | Devises : membre payé hors euros, taux BCE absent (`payroll.fetch_exchange_rates` en échec) | phrase claire, pas de montant inventé |
| E19 | Membre parti : relevé final, « Solde abandonné », brouillon vide à zéro sans rien supprimer | ADR 0072 § 6 mot pour mot |
| E20 | Minimum de versement (plafonné à 5 000 €), délai de versement | Réglages › Règles de paie |
| E21 | Historique, Objectifs, Primes et malus : créer, modifier, verrouiller (ADR 0035) | entrée verrouillée non modifiable |

## 5. Factures et comptabilité

| # | Parcours | Attendu |
|---|---|---|
| E22 | Facture d'un membre, acceptation, rappel d'échéance, avoir, facture rectificative | PDF juste (gabarits du lot 4), numérotation sans trou |
| E23 | Réglages › Facturation : régime franchise, TVA, Bénin | mentions légales justes |
| E24 | Paie › Exports (propriétaire seul) | fichier lisible par un tableur, rien d'un fan |
| E25 | Commissions du chatteur (Relevés, Factures), Moi › Factures du manager | il ne voit que les siennes |

## 6. Chatteur et créatrice

| # | Parcours | Attendu |
|---|---|---|
| E26 | Aujourd'hui du chatteur : avant, pendant, après son shift | « Ouvrir Reveal » en tête ; « Rapport à faire » en ambre ; le gros chiffre est ce qu'il touche |
| E27 | Planning du chatteur, Commissions sur téléphone | même montant une fois, pas de carte vide |
| E28 | Gains de la créatrice dans Ventes, compte en source « déclarée » puis « détectée » (simulé) | sur un compte basculé, `modelRevenue` fait foi ; écart avec le pourcentage signalé au propriétaire seulement |
| E29 | Créatrices › Heures et Pourcentage | taux appliqué au 1er ou au 16 seulement |

## Sans clé, à préparer

- Bascule d'un compte en « détecté » (CRM-03) : interdite tant qu'aucune vérification propre n'existe. Préparer le scénario avec FakeReveal CRM : quinzaine propre, puis bascule à une frontière, puis vérification que l'ancienne quinzaine ne change pas de base.
- Validation automatique des rapports : dépend des totaux lus chez Reveal ; à rejouer avec la vraie clé CRM sur la première quinzaine réelle.
