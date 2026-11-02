# CR-03 Ventes saisies par le chatteur et rapport de fin de shift qui les reprend
Statut : todo (ADR 0043 § 1, § 2, § 3 et § 7, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0043)
Dépend de : EQ-03, EQ-04, CR-01 (téléphone)
Branche : task/cr-03-chatter-sale-entries

## Objectif
Le chatteur saisit chaque vente (fan, montant, type) depuis son téléphone, voit sa commission estimée bouger, et son rapport de fin de shift reprend ses ventes et ses remontées.

## Contexte à lire
`docs/adr/0043-chatter-sale-entries-and-report-check.md`, ADR 0011, 0023 (§ Paie, § Une seule source), 0032, 0035, EQ-03 (contrat `ShiftReport`, verrou (membre, période)), EQ-04 (moteur pur), `packages/contracts/src/shift-reports.ts`.

## À faire
- [ ] Contrats : `SaleEntry` (fan en texte, montant brut en unités mineures et devise du compte, type fermé, note, clé d'idempotence) ; `ReportSignal` (catégorie fermée, phrase). Par le propriétaire de `packages/contracts`.
- [ ] Base (migration attribuée par le propriétaire de `packages/db`) : `sale_entries` avec `creator_id` et `member_id`, RLS sur les deux comme les rapports, unicité de la clé d'idempotence, remplacement par une nouvelle ligne (jamais d'effacement), `audit_log`.
- [ ] Domaine pur : rattachement à un shift du membre sur cette créatrice, en cours ou fini depuis moins de 24 h ; shift d'une quinzaine déjà clôturée : jamais refusé, compté dans la première quinzaine non clôturée (ADR 0032) ; annulation de 5 s ; remplacement tant que le rapport n'est pas validé.
- [ ] Le rapport : montant = somme des ventes saisies (le champ libre disparaît), un shift sans vente à 0, remontées ; contrat et écran mis à jour sans casser les rapports déjà validés.
- [ ] Une correction de rapport (EQ-03, `correctsId`) porte ses propres ventes, dont l'annulation d'une vente sous forme d'un montant négatif : son montant reste la somme de ses ventes.
- [ ] Compteur : commission estimée recalculée par la fonction pure du moteur à chaque saisie, marquée estimée.
- [ ] Écrans téléphone (Aujourd'hui) : « + Vente » en un écran et trois champs, ventes du shift et somme, commission estimée, palier, objectif collectif (affiché sans le net de l'équipe) ; « Faire mon rapport » à la fin.

## Critères d'acceptation
- Tests : double envoi sans doublon, shift d'une autre créatrice refusé (409), shift d'une quinzaine clôturée compté dans la suivante, annulation de 5 s, remplacement, total du rapport = somme, compteur égal au relevé recalculé sur les mêmes entrées.
- Intégration Postgres : deux chatteurs d'une même créatrice ne lisent pas leurs ventes l'un de l'autre.
- Finition : captures téléphone Nuit et Jour, mouvement réduit.

## Hors périmètre
Le contrôle par les ventes de Reveal et la validation automatique (CR-09) ; les retours de l'IA (CR-10).

## Notes de session
