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
- [ ] Domaine pur : rattachement à un shift du membre sur cette créatrice, en cours ou fini depuis moins de 24 h ; shift d'une quinzaine déjà clôturée : jamais refusé ; c'est le **rapport**, validé après la clôture, que le registre `pay_period_reports` compte dans la première quinzaine non clôturée (ADR 0032) : la vente reste rattachée à son shift et ne porte aucune période à elle (pas de colonne de période dans `sale_entries`) ; annulation de 5 s ; remplacement tant que le rapport n'est pas validé.
- [ ] Verrou : créer, corriger ou annuler une vente prend le verrou consultatif (membre, période) de la paie (ADR 0043 § 1).
- [ ] Version lue : remplacer une vente change la version d'un rapport envoyé et pas encore validé ; une validation, humaine ou automatique, d'une version dépassée est refusée (la revue nomme déjà la version lue, migration 0026).
- [ ] Le rapport : montant = somme des ventes saisies (le champ libre disparaît), un shift sans vente à 0, remontées ; contrat et écran mis à jour sans casser les rapports déjà validés.
- [ ] Une correction de rapport (EQ-03, `correctsId`) porte ses propres ventes, dont l'annulation d'une vente sous forme d'un montant négatif : son montant reste la somme de ses ventes.
- [ ] Compteur : commission estimée recalculée par le serveur, par la fonction pure du moteur, et rendue avec chaque saisie, jamais calculée dans le navigateur ; marquée estimée.
- [ ] Écrans téléphone (Aujourd'hui) : « + Vente » en un écran et trois champs, ventes du shift et somme, commission estimée, palier, objectif collectif (affiché sans le net de l'équipe) ; « Faire mon rapport » à la fin.

## Critères d'acceptation
- Tests : double envoi sans doublon, shift d'une autre créatrice refusé (409), shift d'une quinzaine clôturée compté dans la suivante, annulation de 5 s, remplacement, total du rapport = somme, compteur égal au relevé recalculé sur les mêmes entrées.
- Intégration Postgres : deux chatteurs d'une même créatrice ne lisent pas leurs ventes l'un de l'autre ; une vente remplacée pendant la validation de son rapport attend le verrou, et un rapport n'est jamais validé sur une somme qui n'est plus celle de ses ventes ; la validation d'une version dépassée est refusée.
- Finition : captures téléphone Nuit et Jour, mouvement réduit.

## Hors périmètre
Le contrôle par les ventes de Reveal et la validation automatique (CR-09) ; les retours de l'IA (CR-10).

## Notes de session

- 2026-11-02 (fil API CRM) : l'ADR 0050 § 10 (option 3 validée par Charles) retire la saisie d'un compte Reveal dès sa bascule en source « détectée » ; elle reste jusqu'à la bascule et sur les autres plateformes. Recommandation : décider de l'ordre avant de commencer cette fiche, car si le flux de ventes arrive avant elle, « + Vente » n'a plus d'utilité sur Reveal, seule plateforme branchée aujourd'hui.
