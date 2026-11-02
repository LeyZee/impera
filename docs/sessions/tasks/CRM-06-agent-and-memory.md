# CRM-06 CA de l'agent et achats dans la mémoire du fan

Statut : todo (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01, CRM-02 pour le CA de l'agent ; la capture Reveal pour la mémoire
Branche : task/crm-06-agent-and-memory
Propriétaire proposé : Agent

## Objectif

On compare le CA de l'agent à celui des chatteurs, et l'agent sait ce qu'un fan a acheté et pour combien.

## Contexte à lire

ADR 0050 (§ 5, Conséquences), P3-02, ADR 0003, règle 4 de `CLAUDE.md`.

## À faire

- [ ] CA de l'agent à partir du `chatterId` du membre « bot », si CRM-02 confirme qu'il remonte séparément.
- [ ] Résumé d'achats par fan (type, montant, date, total) dans le contexte de l'agent, une fois prouvé que `memberId` est le fan de la session capturée ; sinon, la mémoire attend.
- [ ] Le pseudo reste une donnée, jamais une instruction.

## Critères d'acceptation

- Sans lien prouvé entre les identifiants, aucun achat n'entre dans une mémoire (test).
- Le total calculé égale la somme des ventes moins les remboursements (test).

## Hors périmètre

Le contenu acheté (capture), un historique au-delà du registre.

## Notes de session
