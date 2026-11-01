# Serveur MCP, lot 3 : lectures de l'Équipe (planning, rapports, commissions)
Statut : proposed
Phase : équipe, après EQ-05
Dépend de : lot 1 du MCP, EQ-02, EQ-03, EQ-04, EQ-05
Branche : task/<id>-mcp-team-tools

## Objectif
Un agent de l'agence lit qui est en poste, le planning, les rapports de fin de shift et les relevés de commissions, avec exactement les scopes `owner`, `agency`, `self` de la personne de l'accès.

## Contexte à lire
ADR 0023, 0024, 0026 §4 et §5 ; fiches EQ-02 à EQ-05 ; README des modules `team`, `scheduling`, `payroll`.

## À faire
- [ ] `on_shift_now`, `shifts_list`, `shift_reports_list` (`read:team`), `commission_statements_list` (`read:payroll`), branchés sur les requêtes des `index.ts`, par `withMember`.
- [ ] Aucune écriture de paie ni de facture, aucun dossier prestataire (identité, adresse, identifiant fiscal), aucun taux.
- [ ] Ressource miroir « qui est en poste ».

## Critères d'acceptation
- Tests d'intégration : un accès d'un manager `active` lit l'équipe ; le même manager en congé ne lit que ses lignes ; un accès sans `read:payroll` ne lit aucun relevé ; aucun champ du dossier prestataire dans une réponse.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre
Accès créés par un chatteur ou un manager (attend l'accès borné au shift), écritures.

## Notes de session
