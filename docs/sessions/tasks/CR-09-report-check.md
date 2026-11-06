# CR-09 Contrôle du rapport de fin de shift et validation automatique par les ventes de Reveal
Statut : in_progress (réécrite le 06/11 sur l'ADR 0073 : la comparaison aux ventes lues, la validation automatique et l'écart sont codés sur `claude/project-thread-cohhca-adr0073`, migration 0131 ; restent les signaux toujours actifs de l'ADR 0043 § 4)
Phase : espaces (ADR 0043)
Dépend de : EQ-03 ; CRM-01 (registre des ventes lu) ; la bascule d'un compte reste celle de CRM-03
Branche : claude/project-thread-cohhca-adr0073 pour l'ADR 0073 ; task/cr-09-report-check pour les signaux

## Objectif
Sur un compte Reveal en source « déclarée » dont les ventes sont lues, chaque rapport est comparé à ce que Reveal a lu pendant le shift : dans le seuil et pas au-dessus, il se valide seul ; sinon la validation attend que le membre corrige ou explique (48 h au plus), puis le manager tranche. Rien ne baisse ni ne retient un montant. Les signaux toujours actifs de l'ADR 0043 restent à faire.

## Contexte à lire
`docs/adr/0073-declared-reports-checked-against-reveal-sales.md` (fait foi), `docs/adr/0043-chatter-sale-entries-and-report-check.md` (§ 4, pour les signaux), ADR 0050 (§§ 5, 6, 8, 10), ADR 0025 (marge d'accès), EQ-03.

## À faire
- [x] Comparaison (ADR 0073 § 2) : ventes du membre sur le compte, attribuées par le lien de son pseudo (ADR 0050 § 5), sur la fenêtre d'accès du shift, brut TTC, remboursements connus retirés ; complète seulement un quart d'heure après la fenêtre et après une lecture du registre jusqu'au bout (`sales_feed_cursors.caught_up_at`) ; « provisoire » avant, « indisponible » avec sa raison sans flux, sans modèle reliée ou sans membre relié.
- [x] Seuil réglable (§ 3) : 1 % ou 5 € par défaut, Réglages › Règles de paie, bornés par un CHECK.
- [x] Validation automatique (§ 4) : job `scheduling.check_reports` toutes les cinq minutes, connexion admin, sous le verrou (membre, quinzaine), la version comparée seulement, marque `automatic` sans auteur, refusée à tout membre par la politique ; audit `shift_report.auto_validate`.
- [x] Écart (§ 5) : explication du membre (1 000 caractères, jamais journalisée), validation refusée 409 `shift_report_gap_conflict` jusqu'à l'explication ou 48 h ; le renvoi n'est jamais bloqué ; la validation garde ce qu'elle a vu (`review_check`).
- [x] Écrans (relus par Extension) : le rapport du membre, Mon planning (« Écart · À expliquer »), Aujourd'hui, Équipe › Rapports (deux montants, écart, explication, compte des écarts par membre et quinzaine), Réglages (seuil), carte « Rapports de fin de shift » du Dashboard et bandeau de Paie › Quinzaine pour que rien ne reste sans décision.
- [ ] Signaux toujours actifs (ADR 0043 § 4, ADR 0073 § 8) : bonne créatrice et bon shift ; total au-delà de trois fois la médiane du membre sur 30 jours, seulement avec au moins 5 shifts sur ces 30 jours.
- [ ] À mesurer pendant l'essai (ADR 0073, Conséquences) : la part des rapports dans le seuil, par compte et par quinzaine, avant la bascule de CRM-03.

## Critères d'acceptation
- Test RLS : aucun membre, propriétaire compris, ne pose la marque `automatic` ; une validation sans auteur n'existe qu'avec elle ; une validation automatique d'une version dépassée ne valide rien. (fait)
- Tests : écart exactement au seuil et un centime au-delà, rapport au-dessus de Reveal d'un centime jamais validé seul, vente hors fenêtre et vente d'un autre pseudo jamais comptées, remboursement retiré, flux coupé ou registre pas lu jusqu'au bout jamais validé seul, job rejoué sans doublon, validation humaine bloquée puis libérée par l'explication ou les 48 h. (fait)
- Reste : chatteur nouveau (moins de 5 shifts sur 30 jours) sans signal « total inhabituel ».

## Hors périmètre
Les retours de l'IA (CR-10). Le rapprochement ligne par ligne (fan, montant) de l'ADR 0043 tombe (ADR 0073 § 8).

## Notes de session

- 2026-11-02 (fil API CRM) : l'ADR 0050 change cette fiche. La source du rapprochement est `PlatformSalesFeed` (lecture par curseur), pas `listTransactions`. Seuls `ppv`, `tip` et `paid_message` sans chatteur comptent comme vente sans attribution (§ 6). Un compte Reveal en source « détectée » n'a plus de rapport à rapprocher : mini feedback et deux signaux seulement (§ 10).
- 2026-11-02 (fil API CRM) : sans saisie sur Reveal, seul le signal « total inhabituel » s'applique au total déclaré avant la bascule.
- 2026-11-06 (fil Équipe) : fiche réécrite sur l'ADR 0073 (acceptée, « ok 0073 »). Codés : comparaison, seuil, validation automatique, écart et explication, écrans (captures v1 et v2 validées par Charles). Le seuil de 5 % et 10 € de la fiche d'origine devient 1 % ou 5 €. Une vente sans attribution n'envoie plus le rapport au valideur : elle ne compte pas pour le membre, et l'écart se voit.
