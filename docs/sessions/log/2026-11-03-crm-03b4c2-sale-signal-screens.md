# 2026-11-03 — CRM-03 lot b4c2 : « Mes ventes lues » et le signalement à l'écran — in-progress
Fait : les écrans du signalement (ADR 0050 § 10), selon les précisions d'Extension :
- `payroll/api.ts` : `useMySales` (`GET /v1/payroll/my-sales`, pages par curseur, relu chaque minute) et `signalSale` (`POST /v1/payroll/sale-signals`) ;
- `payroll/my-sales.ts` : les mots sans React. L'heure (« Vente de 22 h 05 »), le net signé, l'état (« Comptée », « Signalée » en ambre tant que la quinzaine est ouverte, « Écartée », « Retirée du relevé »), ce que dit la ligne sous elle, la tête de chaque jour et du panneau, les gestes et leur fenêtre ;
- `screens/pay/MySalesPanel.tsx` : un panneau dans Commissions sous « Le parcours de ton argent », seulement si le relevé a une ligne en net de la plateforme. Les jours se replient, sauf aujourd'hui ; « Ventes plus anciennes » lit la page suivante. « Ce n'est pas ma vente » (bouton discret) ouvre une fenêtre avec une note facultative et la mise en garde « Jamais le message ni le nom d'un fan » ; « Retirer le signalement » la reprend ; aucun geste après la clôture. L'identifiant est tiré une fois, un refus se dit dans la fenêtre et la liste est relue quand il dit qu'elle a bougé ;
- `HeldSalesPanel` : une ligne payée signalée porte « Signalée » en ambre et « Signalée par Théo : ce n'est pas sa vente. « note » » ; l'introduction dit qu'elle compte tant qu'elle n'est pas écartée ;
- les guillemets tiennent leur note par des espaces insécables.
Pas fait : « En attente d'une décision » chez le chatteur (précision 2 d'Extension) : la portée `self` ne lit pas le registre, il faut la projection notée en b4c1.
Décisions :
- un remboursement de son relevé se signale aussi : c'est une ligne qu'il paie, le valideur tranche ;
- jamais la clé de la vente, ni à l'écran ni dans un texte lu par un lecteur d'écran ;
- la tête du panneau somme toute la quinzaine (les `days` du serveur), même quand toutes les pages ne sont pas lues ;
- après la relecture d'Extension : l'introduction nomme la plateforme des lignes (« la plateforme » s'il y en a plusieurs), jamais « Reveal » écrit en dur ; une ligne de remboursement dit « Ce remboursement n'est pas à moi », sa feuille, son état et sa note au masculin, et le valideur lit « Signalé par … : ce n'est pas son remboursement » ; les ids qui nomment un geste au lecteur d'écran prennent la place de la ligne, jamais sa clé.
Découvertes : aucune nouvelle.
Candidats à suppression : aucun.
Vérifié : `my-sales.test.ts` (6) ; `held-sales.test.ts` (1 nouveau) ; `CommissionsPage.test.tsx` (7 nouveaux : jours et états, ligne de remboursement, signaler avec une note, refus et même identifiant, aujourd'hui ouvert et quinzaine clôturée, pages et lecture qui échoue, rien sur rapports) ; `PeriodPage.test.tsx` (1 nouveau : ligne signalée chez le valideur) ; captures dans `/mnt/project-files/reglages-ventes/crm-03/b4c/` ; pnpm check ✓.
