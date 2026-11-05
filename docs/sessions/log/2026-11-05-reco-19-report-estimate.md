# 2026-11-05 — Recette, reco 19 : la commission estimée dans le rapport de fin de shift — done

Fait :

- Contrat (`shift-reports.ts`) : `GET /v1/payroll/shifts/:shiftId/estimate?amountMinor=` rend `{ commissionMinor }`, en centimes d'euro, `null` quand le serveur ne peut pas le dire. `amountMinor` : des chiffres et un moins, une valeur vide n'est pas 0.
- Planning : `pay.shiftFacts(actor, shiftId)` donne le membre du shift, sa quinzaine et ses règles en vigueur, TVA et commission de la plateforme comprises. Il passe par le `context` du magasin des rapports, donc garde les mêmes refus que le panneau.
- Paie : `commissionOfGross` applique à un montant seul la chaîne d'une ligne de relevé (`netOf` est partagé avec `lineOf`). `infra/report-estimate.ts` lit, sous `withMember`, le taux du membre au dernier jour de la quinzaine et le taux de change le plus récent à ce jour ou avant.
- Écran : sous le montant de « Faire mon rapport », une ligne calme « Ta commission estimée : 8,03 € · avant paliers, objectifs, primes et malus ». Pour une correction, « Effet estimé sur ta commission : −0,80 € ». Quand l'agence corrige, la ligne porte le nom du membre. Le montant est demandé après 300 ms sans frappe. La dernière réponse reste affichée tant que la suivante n'est pas arrivée. Rien ne s'affiche sur un montant invalide, sur `null` ou sur une erreur.
- Relecture de #553 (optionnel) : fermer le panneau ouvert depuis la fiche d'un shift dans Équipe › Planning ramène sur la fiche.
- Le panneau s'intitule « Corriger mon rapport » dès « Ajouter une correction », plus seulement quand une correction est rouverte (vu sur les captures).

Décisions :

- La route est dans la paie, pas dans le planning : c'est la paie qui sait compter une commission. Le planning ne lui donne que les faits du shift.
- On affiche une estimation sur le montant seul, sans simuler le relevé entier. Le relevé arrondit une fois par compte et ajoute les paliers, l'objectif d'équipe, les primes et les malus. La ligne le dit au lieu d'avancer un total qu'elle ne peut pas garantir.

Découvertes : les statuts genrés (« Parti », « Suspendu ») sont une question pour Charles, posée par la relecture Extension de #555.

Candidats à suppression : aucun.

Vérifié :

- unitaires : `commission-statements` (même centime qu'un relevé de ce seul montant, signe d'une correction), `reports/model` (les quatre phrases), `ReportPanel` (une seule demande après la pause, rien sans estimation), `PlanningPage` (retour sur la fiche), titre d'une correction ;
- intégration (Testcontainers) : `payroll-report-estimate` (euros, correction, taux du membre quel que soit le lecteur, connecteur, sans règles, dollars sans puis avec taux, collègue et créatrice refusés, montants invalides).
