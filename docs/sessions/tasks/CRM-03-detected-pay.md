# CRM-03 Paie sur les ventes lues, téléphone du chatteur et mini feedback

Statut : todo (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01, l'accord de Charles après CRM-02, CR-01 (téléphone)
Branche : task/crm-03-detected-pay
Propriétaire proposé : Bilan pour la paie, Équipe pour les règles, Extension pour les écrans

## Objectif

Un compte Reveal basculé est payé sur ses ventes lues : le chatteur ne saisit plus rien, voit ses ventes et sa commission, et laisse un mini feedback.

## Contexte à lire

ADR 0050 (§§ 5 à 8, § 10), ADR 0043 (§§ 2, 3, 5, 7), ADR 0023, 0032, 0035, 0039 § 6, fiches CR-03 et CR-09.

## À faire

- [ ] Calcul des montants par plateforme : `netAmount` sur Reveal, chaîne de l'ADR 0023 paramétrée par plateforme ailleurs ; règle datée, posée à une frontière de période, dans les entrées et l'`inputs_hash`.
- [ ] Attribution et vente en attente du valideur (§ 5) ; remboursement après validation en vente tardive négative (§ 7).
- [ ] `shift_feedback` : ventes en lecture seule, commentaire, incident, remontée, ou « rien à signaler » ; rappel, sans effet sur la paie.
- [ ] Téléphone : ventes lues, commission estimée, palier, objectif collectif, sans « + Vente ».
- [ ] Décider avec Charles de l'ordre avec CR-03 : si cette fiche arrive avant, la saisie n'est pas construite pour Reveal.

## Critères d'acceptation

- Recalculer une quinzaine passée ne change ni sa base ni son `inputs_hash` (test).
- Une vente sans chatteur ne compte pour aucun membre ni dans le net de l'équipe (test).
- Un feedback manquant ne change aucun montant (test).

## Hors périmètre

Le rapprochement d'un rapport déclaré (CR-09), les signaux hors shift (CRM-05).

## Notes de session
