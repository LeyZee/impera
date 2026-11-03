# CRM-03 Paie sur les ventes lues, téléphone du chatteur et mini feedback

Statut : in-progress (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01, l'accord de Charles après CRM-02, CR-01 (téléphone)
Branche : task/crm-03-detected-pay
Propriétaire proposé : Bilan pour la paie, Équipe pour les règles, Extension pour les écrans

## Objectif

Un compte Reveal basculé est payé sur ses ventes lues : le chatteur ne saisit plus rien, voit ses ventes et sa commission, et laisse un mini feedback.

## Contexte à lire

Prototype de l'espace chatteur pour l'option 3 : https://claude.ai/artifact/Lc2yn1cyu8RuJqA5WGt4ph (copie hors dépôt : `espaces/prototype-chatteur/`). ADR 0050 (§§ 5 à 8, § 10), ADR 0043 (§§ 2, 3, 5, 7), ADR 0023, 0032, 0035, 0039 § 6, fiches CR-03 et CR-09.

## À faire

- [ ] Calcul des montants par plateforme : `netAmount` sur Reveal, chaîne de l'ADR 0023 paramétrée par plateforme ailleurs ; règle datée, posée à une frontière de période, dans les entrées et l'`inputs_hash`.
- [ ] Attribution et vente en attente du valideur (§ 5) ; remboursement après validation en vente tardive négative (§ 7).
- [ ] `shift_feedback` : ventes en lecture seule, commentaire, incident, remontée, ou « rien à signaler » ; rappel, sans effet sur la paie.
- [ ] Téléphone : ventes lues, commission estimée, palier, objectif collectif, sans « + Vente ».
- [ ] Une vente lue attribuée à tort au chatteur : il la signale au valideur, sans effet sur la paie tant que le valideur n'a pas tranché.
- [ ] Avant la bascule, le téléphone garde le total déclaré (EQ-03) ; CR-03 n'est pas construite pour Reveal.

## Critères d'acceptation

- Recalculer une quinzaine passée ne change ni sa base ni son `inputs_hash` (test).
- Une vente sans chatteur ne compte pour aucun membre ni dans le net de l'équipe (test).
- Un feedback manquant ne change aucun montant (test).

## Hors périmètre

Le rapprochement d'un rapport déclaré (CR-09), les signaux hors shift (CRM-05).

## Notes de session

03/11/2026, Bilan, après la relecture Équipe de la vérification (CRM-02, #416) : la bascule d'un compte en « détectée » exige un rapport `match` sur une quinzaine passée, sans note `bot_not_linked_to_agent` ni `export_unknown_model`.

03/11/2026, coordinateur : partage du travail. Équipe fait le calcul (base par plateforme, attribution aux shifts, remboursements tardifs, `inputs_hash`). Bilan fait le serveur hors calcul : le port de lecture, la garde de bascule au moment où la règle est posée, puis `shift_feedback`. Extension fait les écrans.

03/11/2026, Bilan, lot a : `salesFeedReadsForPay` (index de `connectors`) lit une ligne par vente ou par remboursement, avec son auteur selon le lien et la version de ce lien (migration `link_version`). `earningsBaseOf` (contrats) dit la base d'une vente selon la plateforme et la source des règles du compte. Reste :
- **Équipe** : brancher le port dans le recalcul.
- **Bilan** : la garde de bascule. Elle lève `pay_rules_source_conflict` pour un compte Reveal relié à un modèle quand le dernier rapport de vérification est `match` propre, sur une quinzaine passée, et seulement une fois le calcul d'Équipe fusionné. Il faut pour cela garder les rapports, ce qui demande une migration.
- **Bilan** : `shift_feedback`, puis le téléphone (Extension).

03/11/2026, Équipe, lot b1 : les règles pures du calcul (`payroll/domain/sales.ts`), branchées dans le recalcul. Une vente compte pour un membre si son lien pointe vers lui, s'il était en poste ou dans sa marge d'accès à l'heure de la vente, si la quinzaine de la vente est en `platform_net` et si son statut est connu ; sinon elle est à personne (agent, sans chatteur), en attente (chatteur non relié, hors poste, statut inconnu, remboursement d'une vente jamais payée sur ce net) ou hors du net (compte encore payé sur ses rapports). Les ventes comptées d'un compte forment une ligne `platform_net` du relevé. Une quinzaine clôturée recompte exactement ce que sa clôture a enregistré (membre et version du lien) ; les tardives vont dans la première quinzaine ouverte ; un remboursement va au membre que sa vente a payé. Le remboursement d'une vente d'avant le registre ou d'avant la bascule est en attente, sans déduction, en attendant la réponse de Charles (03/11). Rien ne lit encore de vente (`NO_SALES`). Reste :
- **Équipe, lot b2** : lire les ventes, les shifts, la marge et les sources par `PayInputReads` ; migration du registre des ventes comptées (`pay_period_sales`) et des colonnes `base` et `sales` des lignes de relevé ; écriture du registre à la clôture ; relecture Bilan.
- **Équipe, lot b3** : décision du valideur sur une vente en attente, côté paie.
- **Équipe et Extension, lot b4** : « net Reveal » sur l'annexe de la facture et les écrans. La garde de bascule de Bilan attend b4.
